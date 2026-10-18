# 32. Pictures from local copies, never from the network at play or render time

- Status: Accepted; amended by [0035](0035-bounds-from-the-0.28-review.md)
- Date: 2026-10-18

## Context

A photo, a screenshot or a reaction image is the device the research found most used and mr-cast most lacked (D18 in `docs/research/youtube-devices.md`), and it helps before-and-after comparisons (D4). The research deferred it as a product question: pictures break two properties of every example so far, that the video is generated entirely from the storyboard and that nothing in it needs a licence. The user decided: "yes, any image", the licence being the user's responsibility.

## Decision

- **Where a picture may appear.** An `image` scene, and a compare cell `{ "image": ..., "fit"? }`. The scene has `fit` (`contain` or `cover`), a `caption`, a `credit`, `kenBurns` (a slow pan and zoom between two regions or boxes over the scene), and `regions`: boxes as fractions of the picture that steps light, ink draws on and the highlight check names by `label`. A text scene takes no picture: the image scene's title and caption carry the words, and every lead, item and side layout would otherwise need a second arrangement.
- **Sources become local copies at the boundary.** `src` is a path relative to the run directory or the repository, or an http(s) URL. `validate` (`bin/lib/images.mjs`) copies a local file into the run's `images/` folder under its content hash, or downloads a URL there once under the URL's hash, and writes `images.json`, which maps each `src` to its copy and size. A later run finds a URL's copy by its hash and asks no server. The validate hook's read-only check writes and downloads nothing and warns that a URL is not downloaded yet.
- **Only images, only small ones.** A picture must be a PNG, JPEG, WebP or GIF file, checked by its first bytes, and for a URL by the server's content type as well; up to 10 MB, checked against `Content-Length` and again while the body streams. SVG is refused, because an SVG picture can carry scripts and links that bypass the svg scene's sanitizer (ADR 0020). The size a browser draws, the JPEG orientation included, is read from the header.
- **Nothing loads from the network at play or render time.** The player's server serves `/data/images/<16 hex digits>.<type>` from the run's `images/` folder and nothing else of it; renders serve the same names from a local server for the length of the render. The composition gets `images.json` and a base URL as props, and draws Remotion's `Img`, which holds the frame until the picture has loaded.
- **Errors say why.** `validate` fails on a missing file, one outside the run directory and the repository, an absolute path, a scheme other than http(s), a file of the wrong type, an oversized file, and a URL it cannot download, naming the HTTP status or the system error. It warns when a picture is drawn more than twice its own size, which looks soft.
- **The licence is a fact in the reference, not advice**: mr-cast does not make or change pictures, and whoever makes the video owns the right to use them.

## Alternatives considered

- **Serve the source path or URL directly.** The player would read any file the storyboard names and a render would depend on a remote server staying up and unchanged; a local copy makes both deterministic.
- **Inline pictures as data URIs in the render props.** Ten megabytes per picture through Remotion's props; the local server streams them instead.
- **An `<image>` element in the svg scene.** It would reopen the sanitizer to external references, which ADR 0020 closed; regions on an image scene give the same pointing without it.
- **A picture in the text scene.** Useful beside a headline, but it multiplies the text layouts; left for a later decision.

## Consequences

- A storyboard can show a photo with the voice pointing at its parts, push slowly into it, and compare two screenshots row by row.
- A run directory now holds `images/` and `images.json` beside `audio/` and `voiceover.json`.
- The example's pictures are drawn by its own `make-pictures.mjs`, so the repository ships no third-party image.
- Ink on a picture that pans stays where its region was when the step's pen started.
- Nothing is superseded.
