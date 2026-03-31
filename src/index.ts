
// For AutoRouter documentation refer to https://itty.dev/itty-router/routers/autorouter
import { AutoRouter } from 'itty-router';

// Lookup table mapping X-Men character names to image URLs
// Keys should be lowercase for case-insensitive matching
const studentImages: Record<string, string> = {
  "wolverine": "https://static.wikia.nocookie.net/marvelcinematicuniverse/images/7/7c/Wolverine_Infobox.png/revision/latest?cb=20240522015042",
  "storm": "https://static.wikia.nocookie.net/moviemorgue/images/9/93/Xmen_storm.png/revision/latest?cb=20161108202445",
  "xavier": "https://static.wikia.nocookie.net/spiderman-animated/images/a/a6/780897890.PNG/revision/latest?cb=20160123032045",
  "cyclops": "https://media.gq.com/photos/66049ca2d6bafed5ec9b791f/1:1/w_1748,h_1748,c_limit/AAM0370_comp_Tk2_v001_r709.117420_C.jpg",
  "magneto": "https://www.writeups.org/wp-content/uploads/Magneto-Marvel-Comics-X-Men-Eisenhardt-Lehnsherr-Magnus-d.jpg",
  
};

let router = AutoRouter();

// Route ordering matters, the first route that matches will be used
// Any route that does not return will be treated as a middleware
// Any unmatched route will return a 404
router
  .get('/', () => new Response('Hello, Spin!'))
  .get('/hello/:name', ({ name }) => `Hello, ${name}!`)
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

