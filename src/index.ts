
// For AutoRouter documentation refer to https://itty.dev/itty-router/routers/autorouter
import { AutoRouter } from 'itty-router';

// Lookup table mapping X-Men character names to image URLs
// Keys should be lowercase for case-insensitive matching
const studentImages: Record<string, string> = {
  "wolverine": "https://static.wikia.nocookie.net/marvelcinematicuniverse/images/7/7c/Wolverine_Infobox.png/revision/latest?cb=20240522015042",
  "storm": "https://static.wikia.nocookie.net/moviemorgue/images/9/93/Xmen_storm.png/revision/latest?cb=20161108202445",
  "xavier": "https://static.wikia.nocookie.net/spiderman-animated/images/a/a6/780897890.PNG/revision/latest?cb=20160123032045",
  "cyclops": "https://static0.srcdn.com/wordpress/wp-content/uploads/2025/08/x-men-s-cyclops-art.jpg?w=1200&h=675&fit=crop",
  "magneto": "https://www.writeups.org/wp-content/uploads/Magneto-Marvel-Comics-X-Men-Eisenhardt-Lehnsherr-Magnus-d.jpg",
  "rogue": "https://i.redd.it/fwvfuzeqdvva1.jpg",
  "gambit": "https://www.diamondartclub.com/cdn/shop/files/gambit-diamond-art-painting-45576248393921.jpg?v=1762461190&width=900"

};

let router = AutoRouter();

// Route ordering matters, the first route that matches will be used
// Any route that does not return will be treated as a middleware
// Any unmatched route will return a 404
router
  .get('/', () => {
    const students = Object.keys(studentImages);
    const tableRows = students.map(name => `<tr><td><a href="/student/${encodeURIComponent(name)}" target="_blank">${name}</a></td><td><img src="${studentImages[name]}" width="100" alt="${name} preview"></td></tr>`).join('');
    const html = `
<!DOCTYPE html>
<html>
<head>
  <title>School for Gifted Youngsters</title>
  <style>
    body { text-align: center; font-family: Arial, sans-serif; background-color: #f0f0f0; }
    h1 { color: #333; margin-top: 50px; }
    p { color: #666; }
    table { margin: 20px auto; border-collapse: collapse; background-color: white; box-shadow: 0 0 10px rgba(0,0,0,0.1); }
    th, td { padding: 15px; border: 1px solid #ccc; text-align: center; }
    th { background-color: #f8f8f8; }
    a { text-decoration: none; color: #007bff; font-size: 18px; }
    a:hover { text-decoration: underline; }
    img { border-radius: 5px; }
    footer { margin-top: 50px; color: #666; font-size: 14px; }
  </style>
</head>
<body>
  <h1>Welcome to the School for Gifted Youngsters's Facebook!</h1>
  <p>Click on a student to see their ASCII art:</p>
  <table>
    <thead>
      <tr><th>Student</th><th>Preview</th></tr>
    </thead>
    <tbody>
      ${tableRows}
    </tbody>
  </table>
  <footer>Powered by Spin and Akamai Functions</footer>
</body>
</html>
    `;
    return new Response(html, { headers: { 'content-type': 'text/html' } });
  })
  .get('/student/:name', async (req) => {
    const { name } = req.params as { name: string };
    const url = new URL(req.url);

    // Case-insensitive lookup
    const imageUrl = studentImages[name.toLowerCase()];
    if (!imageUrl) {
      return new Response(
        `Unknown student "${name}". Available: ${Object.keys(studentImages).join(', ') || '(none configured)'}`,
        { status: 404, headers: { 'content-type': 'text/plain' } }
      );
    }

    // Check if raw image is requested
    const raw = url.searchParams.get('raw');
    if (raw === 'true') {
      console.log("Returning raw image for", name, "at", imageUrl);
      const response = await fetch(imageUrl);
      return new Response(response.body, {
        status: response.status,
        headers: response.headers,
      });
    }

    // Read optional query params, with defaults for rasciify + bar + color
    const charset = url.searchParams.get('charset') ?? 'bar';
    const color = url.searchParams.get('color') ?? 'true';

    const params = new URLSearchParams({
      img: imageUrl,
      model: 'rasciify',
      charset,
      color,
    });

    const internalUrl = `http://image-processor.spin.internal/?${params.toString()}`;
    console.log("Forwarding student request to image-processor at", internalUrl);
    return fetch(internalUrl);
  })
  .get('/ascii', async (req) => {
    // Forward to the Rust image-processor component via local service chaining
    const url = new URL(req.url);
    const internalUrl = `http://image-processor.spin.internal/${url.search}`;
    console.log("Forwarding request to image-processor at", internalUrl);
    return fetch(internalUrl);
  })

//@ts-ignore
addEventListener('fetch', (event: FetchEvent) => {
  event.respondWith(router.fetch(event.request));
});

