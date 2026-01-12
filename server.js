import express from 'express';
import fetch from 'node-fetch';
import iconv from 'iconv-lite';
import FormData from 'form-data';

const app = express();
app.use(express.json()); // ✅ 괄호 꼭

/**
 * (텍스트 only 전송용) 네이버 카페 API가 요구하는 "특이 인코딩" 대응
 * - x-www-form-urlencoded로 보낼 때 사용
 */
function toNaverEncoded(str) {
  const utf8UrlEncoded = encodeURIComponent(str);
  const reinterpreted = iconv.decode(Buffer.from(utf8UrlEncoded, 'utf8'), 'cp949');
  const buf = iconv.encode(reinterpreted, 'cp949');

  return Array.from(buf)
    .map((b) => '%' + b.toString(16).toUpperCase().padStart(2, '0'))
    .join('');
}

function pickFilenameFromUrl(urlStr, fallbackExt = 'jpg') {
  try {
    const u = new URL(urlStr);
    const last = u.pathname.split('/').pop() || `image.${fallbackExt}`;
    return last.includes('.') ? last : `${last}.${fallbackExt}`;
  } catch {
    return `image.${fallbackExt}`;
  }
}

async function downloadImageAsBuffer(urlStr) {
  const u = new URL(urlStr);
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error(`Only http/https allowed: ${urlStr}`);
  }

  const r = await fetch(urlStr);
  if (!r.ok) {
    throw new Error(`Image download failed (${r.status}): ${urlStr}`);
  }

  const contentType = r.headers.get('content-type') || 'application/octet-stream';
  const buf = Buffer.from(await r.arrayBuffer());
  return { buf, contentType };
}

app.post('/cafe/post', async (req, res) => {
  const { subject, content, image, clubid, menuid } = req.body;
  const authHeader = req.headers.authorization;

  if (!authHeader) return res.status(401).json({ error: 'Missing Authorization header' });
  if (!subject || !content || !clubid || !menuid) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const url = `https://openapi.naver.com/v1/cafe/${clubid}/menu/${menuid}/articles`;

  try {
    // ✅ 디버그(원인 확인용): 필요 없으면 지워도 됨
    // console.log('[DEBUG] subject from n8n:', subject);

    // 1) 이미지가 없으면: 기존 방식(텍스트만) 유지
    if (!image || (Array.isArray(image) && image.length === 0)) {
      const body = `subject=${toNaverEncoded(subject)}&content=${toNaverEncoded(content)}`;

      const r = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
      });

      const text = await r.text();
      return res.status(r.status).send(text);
    }

    // 2) 이미지가 있으면: multipart/form-data
    const imageUrls = Array.isArray(image) ? image : [image];
    if (imageUrls.length > 10) {
      return res.status(400).json({ error: 'Too many images (max 10)' });
    }

    const form = new FormData();

    /**
     * 🔥 핵심: multipart에서는 subject/content를 URL 인코딩 문자열로 넣으면
     * 네이버가 디코딩하지 않고 "그대로 저장"해서 %EC%..가 노출될 수 있음.
     *
     * 그래서 subject/content를 "CP949 바이트(Buffer)"로 넣고 charset을 명시.
     * (이게 지금 문제를 잡는 가장 확실한 방법)
     */
    form.append('subject', iconv.encode(subject, 'cp949'), {
      contentType: 'text/plain; charset=MS949',
    });
    form.append('content', iconv.encode(content, 'cp949'), {
      contentType: 'text/plain; charset=MS949',
    });

    // 이미지 파일 첨부 (URL -> 다운로드 -> 파일로 append)
    for (const imgUrl of imageUrls) {
      const { buf, contentType } = await downloadImageAsBuffer(imgUrl);
      const ext = contentType.includes('png') ? 'png' : (contentType.includes('webp') ? 'webp' : 'jpg');
      const filename = pickFilenameFromUrl(imgUrl, ext);

      form.append('image', buf, { filename, contentType });
    }

    const r = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: authHeader,
        ...form.getHeaders(), // boundary 포함
      },
      body: form,
    });

    const text = await r.text();
    return res.status(r.status).send(text);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: String(err?.message || err) });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
