import express from 'express';
import fetch from 'node-fetch';
import iconv from 'iconv-lite';

const app = express();
app.use(express.json());

function toCp949(str) {
  const buf = iconv.encode(str, 'cp949');
  return Array.from(buf)
    .map(b => '%' + b.toString(16).toUpperCase().padStart(2, '0'))
    .join('');
}

app.post('/cafe/post', async (req, res) => {
  const { subject, content, clubid, menuid } = req.body;
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({ error: 'Missing Authorization header' });
  }

  if (!subject || !content || !clubid || !menuid) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const body =
    `subject=${toCp949(subject)}&content=${toCp949(content)}`;

  const url =
    `https://openapi.naver.com/v1/cafe/${clubid}/menu/${menuid}/articles`;

  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: authHeader,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body
    });

    const text = await r.text();
    res.status(r.status).send(text);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Proxy server error' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
