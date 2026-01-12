import express from 'express';
import fetch from 'node-fetch';
import iconv from 'iconv-lite';
import FormData from 'form-data';

const app = express();
app.use(express.json()); // ✅ 괄호 꼭 필요

function toNaverEncoded(str) {
  // 1) UTF-8 기반 URL 인코딩(= %XX 문자열)
  const utf8UrlEncoded = encodeURIComponent(str);

  // 2) 그 문자열의 UTF-8 바이트를 CP949로 디코딩(재해석)
  const reinterpreted = iconv.decode(Buffer.from(utf8UrlEncoded, 'utf8'), 'cp949');

  // 3) 다시 CP949로 인코딩 후 %XX로 변환
  const buf = iconv.encode(reinterpreted, 'cp949');

  return Array.from(buf)
    .map(b => '%' + b.toString(16).toUpperCase().padStart(2, '0'))
    .join('');
}

function pickFilenameFromUrl(urlStr, fallbackExt = 'jpg') {
  try {
    const u = new URL(urlStr);
    const last = u.pathname.split('/').pop() || `image.${fallbackExt}`;
    // 쿼리 제거된 pathname이라 안전, 그래도 최소 정리
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

  if (!authHeader) {
    return res.status(401).json({ error: 'Missing Authorization header' });
  }

  if (!subject || !content || !clubid || !menuid) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const url = `https://openapi.naver.com/v1/cafe/${clubid}/menu/${menuid}/articles`;

  try {
    // ✅ 이미지가 없으면: 기존처럼 x-www-form-urlencoded로 전송
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

    // ✅ 이미지가 있으면: multipart/form-data로 전송 (문서 요구사항)
    const imageUrls = Array.isArray(image) ? image : [image];
    if (imageUrls.length > 10) {
      return res.status(400).json({ error: 'Too many images (max 10)' });
    }

    const form = new FormData();

    // subject/content는 문서처럼 URL 인코딩 + (네이버식) 재인코딩된 값을 넣어줌
    form.append('subject', toNaverEncoded(subject));
    form.append('content', toNaverEncoded(content));

    // 여러 장이면 image 파라미터를 반복해서 append (문서/예제 방식)
    for (const imgUrl of imageUrls) {
      const { buf, contentType } = await downloadImageAsBuffer(imgUrl);

      // filename은 URL에서 추정
      const filename = pickFilenameFromUrl(imgUrl, contentType.includes('png') ? 'png' : 'jpg');

      form.append('image', buf, { filename, contentType });
    }

    const r = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: authHeader,
        ...form.getHeaders(), // ✅ boundary 포함 Content-Type 자동 생성
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
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
