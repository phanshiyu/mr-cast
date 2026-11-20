// Writes storyboard.json, hunks.json and meta.json beside this file. Run: node examples/architecture/oauth/generate.mjs
import { createHash } from 'node:crypto';
import fs from 'node:fs';

// RFC 7636 appendix B: the verifier and the challenge it hashes to.
const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const digest = createHash('sha256').update(verifier).digest();
const challenge = digest.toString('base64url');
if (challenge !== 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM') throw new Error('PKCE pair does not match RFC 7636');
const hex = digest.toString('hex');
const redirect = encodeURIComponent('https://printmyphotos.com/callback');
const expiresIn = 3600;
const tokenMinutes = expiresIn / 60;

const arrowDefs = (tones) =>
  `<defs>${tones
    .map(
      (t) =>
        `<marker id="head-${t}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="var(--${t})" stroke="none"/></marker>`,
    )
    .join('')}</defs>`;
const arrow = (x1, y1, x2, y2, tone = 'text', extra = '') =>
  `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="var(--${tone})" stroke-width="4" marker-end="url(#head-${tone})"${extra}/>`;

// Scenes 1 and 11: Alice's Google account, first with her password handed over, then with OAuth.
const account = `<svg viewBox="0 0 1200 640">
${arrowDefs(['muted', 'bad', 'good', 'text'])}
<g id="alice"><circle cx="140" cy="330" r="62" stroke-width="3"/><text x="140" y="343" text-anchor="middle" font-size="34">Alice</text><text x="140" y="430" text-anchor="middle" font-size="22" fill="var(--muted)">owns the photos</text></g>
<g id="pmp"><rect x="430" y="270" width="300" height="120" rx="16" stroke-width="3"/><text x="580" y="322" text-anchor="middle" font-size="30">PrintMyPhotos</text><text x="580" y="360" text-anchor="middle" font-size="22" fill="var(--muted)">prints your photos</text></g>
<g id="google"><rect x="880" y="150" width="280" height="360" rx="16" stroke-width="3"/><text x="1020" y="196" text-anchor="middle" font-size="30">Google account</text>
<g id="photos"><rect x="910" y="222" width="220" height="56" rx="10"/><text x="1020" y="259" text-anchor="middle" font-size="24">Photos</text></g>
<g id="others"><rect x="910" y="292" width="220" height="56" rx="10"/><text x="1020" y="329" text-anchor="middle" font-size="24">Gmail</text><rect x="910" y="362" width="220" height="56" rx="10"/><text x="1020" y="399" text-anchor="middle" font-size="24">Drive</text><rect x="910" y="432" width="220" height="56" rx="10"/><text x="1020" y="469" text-anchor="middle" font-size="24">Calendar</text></g></g>
<g id="password">${arrow(210, 330, 420, 330, 'bad')}<text x="315" y="312" text-anchor="middle" font-size="22" font-family="mono" class="tone-bad">password</text></g>
<g id="login">${arrow(740, 330, 870, 330, 'muted')}<text x="805" y="312" text-anchor="middle" font-size="22" fill="var(--muted)">as Alice</text></g>
<g id="warn-all"><rect x="350" y="60" width="460" height="56" rx="28" class="tone-bad"/><text x="580" y="97" text-anchor="middle" font-size="24">1. Opens everything, not just photos</text></g>
<g id="warn-db"><rect x="350" y="130" width="460" height="56" rx="28" class="tone-bad"/><text x="580" y="167" text-anchor="middle" font-size="24">2. Password sits in their database</text></g>
<g id="warn-revoke"><rect x="350" y="470" width="460" height="56" rx="28" class="tone-bad"/><text x="580" y="507" text-anchor="middle" font-size="24">3. To stop it, change the password</text></g>
<text id="oauth-q" x="600" y="600" text-anchor="middle" font-size="28">OAuth asks: what may this app touch? Not: who are you?</text>
<g id="pw-google"><path d="M150,262 Q480,20 900,140" fill="none" stroke="var(--good)" stroke-width="4" marker-end="url(#head-good)"/><text x="520" y="62" text-anchor="middle" font-size="24" class="tone-good">password, only on Google’s own page</text></g>
<g id="token-line">${arrow(740, 300, 900, 254, 'good')}<text x="790" y="250" text-anchor="middle" font-size="24" font-family="mono" class="tone-good">token</text></g>
<text id="one-hour" x="580" y="440" text-anchor="middle" font-size="24" fill="var(--muted)">token runs out in ${tokenMinutes} min</text>
</svg>`;

// Scene 2: the master key and the valet key.
const key = (id, x, y, name, teeth) =>
  `<g id="${id}"><circle cx="${x}" cy="${y}" r="42" fill="none" stroke="var(--text)" stroke-width="4"/><circle cx="${x}" cy="${y}" r="14" fill="none" stroke="var(--text)" stroke-width="3"/><line x1="${x + 42}" y1="${y}" x2="${x + 200}" y2="${y}" stroke="var(--text)" stroke-width="6"/><polyline points="${teeth.map(([dx, dy]) => `${x + dx},${y + dy}`).join(' ')}" fill="none" stroke="var(--text)" stroke-width="5"/><text x="${x + 80}" y="${y + 90}" text-anchor="middle" font-size="30">${name}</text></g>`;
const cell = (id, x, y, text, cls = '') =>
  `<text id="${id}" x="${x}" y="${y}" text-anchor="middle" font-size="26"${cls ? ` class="${cls}"` : ''}>${text}</text>`;
const valet = `<svg viewBox="0 0 1200 640">
${key('master', 540, 110, 'Master key', [
  [150, 0],
  [150, 30],
  [170, 30],
  [170, 20],
  [185, 20],
  [185, 34],
  [200, 34],
  [200, 0],
])}
${key('valet', 890, 110, 'Valet key', [
  [170, 0],
  [170, 22],
  [200, 22],
  [200, 0],
])}
<g id="row-start"><text x="40" y="330" font-size="28">Starts the car</text>${cell('m-start', 620, 330, 'Yes')}${cell('v-start', 970, 330, 'Yes')}</g>
<g id="row-who"><text x="40" y="420" font-size="28">Who holds it</text>${cell('m-who', 620, 420, 'You')}${cell('v-who', 970, 420, 'The valet, for one evening')}</g>
<g id="row-trunk"><text x="40" y="510" font-size="28">Trunk and glove box</text>${cell('m-trunk', 620, 510, 'Open', 'tone-bad')}${cell('v-trunk', 970, 510, 'Stay locked', 'tone-good')}</g>
<line x1="40" y1="270" x2="1160" y2="270" stroke="var(--border)" stroke-width="2"/>
</svg>`;

// Scenes 3, 6 and 10: the four players, and the messages between them.
const actor = (id, x, y, w, name, capId, cap, capX, capY, anchor = 'middle') =>
  `<g id="${id}"><rect x="${x}" y="${y}" width="${w}" height="100" rx="16" stroke-width="3"/><text x="${x + w / 2}" y="${y + 60}" text-anchor="middle" font-size="30">${name}</text></g><text id="${capId}" x="${capX}" y="${capY}" text-anchor="${anchor}" font-size="24" fill="var(--muted)">${cap}</text>`;
const msg = (id, line, label, lx, ly, anchor, cls = '') =>
  `<g id="${id}">${line}<text x="${lx}" y="${ly}" text-anchor="${anchor}" font-size="24"${cls ? ` class="${cls}"` : ''}>${label}</text></g>`;
const A2U = arrow(272, 262, 462, 112);
const U2A = arrow(479, 134, 289, 284);
const A2P = arrow(272, 350, 462, 470);
const P2A = arrow(477, 446, 287, 326);
const UP = arrow(585, 440, 585, 148);
const DOWN = arrow(640, 148, 640, 436, 'good');
const P2I = arrow(758, 470, 912, 470);
const I2P = arrow(912, 512, 758, 512);
const cast = `<svg viewBox="0 0 1200 640">
${arrowDefs(['text', 'good'])}
${actor('alice', 40, 250, 220, 'Alice', 'cap-alice', 'resource owner', 150, 395)}
${actor('auth', 470, 40, 290, 'Sign-in service', 'cap-auth', 'authorization server', 780, 98, 'start')}
${actor('app', 470, 440, 290, 'PrintMyPhotos', 'cap-app', 'client', 615, 580)}
${actor('api', 920, 440, 240, 'Photos API', 'cap-api', 'resource server', 1040, 580)}
<g id="token"><rect x="800" y="330" width="230" height="50" rx="25" class="tone-good"/><text x="915" y="363" text-anchor="middle" font-size="24">access token</text></g>
${msg('m-authorize', A2U, 'GET /authorize + challenge', 345, 170, 'end')}
${msg('m-allow', A2U, 'Allow', 345, 170, 'end')}
${msg('m-consent', U2A, 'view your photos?', 365, 250, 'start')}
${msg('m-code', U2A, 'go back with a code', 365, 250, 'start')}
${msg('m-go', P2A, 'go to /authorize', 400, 360, 'start')}
${msg('m-callback', A2P, '/callback?code=AUTH_CODE_789', 380, 470, 'end')}
${msg('m-swap', UP, 'code + verifier', 570, 310, 'end')}
${msg('m-tokens', DOWN, 'access + refresh token', 655, 300, 'start', 'tone-good')}
${msg('m-bearer', P2I, 'Bearer', 835, 455, 'middle')}
${msg('m-photos', I2P, 'photos', 835, 545, 'middle')}
</svg>`;
const msgs = [
  'm-authorize',
  'm-allow',
  'm-consent',
  'm-code',
  'm-go',
  'm-callback',
  'm-swap',
  'm-tokens',
  'm-bearer',
  'm-photos',
];
const caps = ['cap-alice', 'cap-auth', 'cap-app', 'cap-api'];

// Scene 4: making the PKCE pair.
const pkce = `<svg viewBox="0 0 1200 600">
${arrowDefs(['muted'])}
<g id="verifier"><text x="600" y="50" text-anchor="middle" font-size="24" fill="var(--muted)">code_verifier: 43 random characters, kept on the phone</text><rect x="150" y="70" width="900" height="70" rx="12" class="tone-good" stroke-width="3"/><text x="600" y="116" text-anchor="middle" font-size="26" font-family="mono">${verifier}</text></g>
<line x1="600" y1="150" x2="600" y2="200" stroke="var(--muted)" stroke-width="4" marker-end="url(#head-muted)"/>
<g id="sha"><rect x="470" y="205" width="260" height="56" rx="28"/><text x="600" y="242" text-anchor="middle" font-size="26" font-family="mono">SHA-256</text></g>
<line x1="600" y1="266" x2="600" y2="306" stroke="var(--muted)" stroke-width="4" marker-end="url(#head-muted)"/>
<g id="bytes"><text x="600" y="336" text-anchor="middle" font-size="22" fill="var(--muted)">32 bytes, written here in hex</text><text x="600" y="372" text-anchor="middle" font-size="22" font-family="mono">${hex}</text></g>
<line x1="600" y1="388" x2="600" y2="428" stroke="var(--muted)" stroke-width="4" marker-end="url(#head-muted)"/>
<g id="b64"><rect x="450" y="432" width="300" height="56" rx="28"/><text x="600" y="469" text-anchor="middle" font-size="26" font-family="mono">BASE64URL</text></g>
<line x1="600" y1="493" x2="600" y2="513" stroke="var(--muted)" stroke-width="4" marker-end="url(#head-muted)"/>
<g id="challenge"><rect x="150" y="518" width="900" height="70" rx="12" stroke-width="3"/><text x="600" y="564" text-anchor="middle" font-size="26" font-family="mono">${challenge}</text></g>
</svg>`;

// Scene 9: one token's life, in minutes.
const T = (m) => 100 + m * 8; // 0 to 125 minutes across 100 to 1100
const tick = (m) =>
  `<line x1="${T(m)}" y1="412" x2="${T(m)}" y2="428" stroke="var(--muted)" stroke-width="3"/><text x="${T(m)}" y="600" text-anchor="middle" font-size="22" fill="var(--muted)">${m} min</text>`;
const event = (id, m, lines, y, anchor, cls = '') =>
  `<g id="${id}"><circle cx="${T(m)}" cy="420" r="9" fill="var(--text)" stroke="none"/>${lines.map((l, k) => `<text x="${T(m) + (anchor === 'end' ? -10 : anchor === 'start' ? 10 : 0)}" y="${y + k * 32}" text-anchor="${anchor}" font-size="${k ? 22 : 24}"${k ? ' fill="var(--muted)"' : cls ? ` class="${cls}"` : ''}>${l}</text>`).join('')}</g>`;
const life = `<svg viewBox="0 0 1200 640">
<line x1="${T(0)}" y1="420" x2="${T(125)}" y2="420" stroke="var(--text)" stroke-width="3"/>
${[0, 30, 60, 90, 120].map(tick).join('')}
<g id="first"><rect x="${T(0)}" y="300" width="${T(tokenMinutes) - T(0)}" height="56" rx="10" class="tone-good"/><text x="${(T(0) + T(tokenMinutes)) / 2}" y="336" text-anchor="middle" font-size="24">first token, ${tokenMinutes} min</text></g>
<g id="second"><rect x="${T(61)}" y="220" width="${T(61 + tokenMinutes) - T(61)}" height="56" rx="10" class="tone-good"/><text x="${(T(61) + T(61 + tokenMinutes)) / 2}" y="256" text-anchor="middle" font-size="24">second token, ${tokenMinutes} min</text></g>
${event('issued', 0, ['token issued', `expires_in ${expiresIn}`], 470, 'start')}
${event('works', 30, ['photos load', '200 OK'], 470, 'middle')}
${event('expired', tokenMinutes, ['token expires', '401 Unauthorized'], 470, 'end')}
${event('refresh', 61, ['refresh', 'sends refresh_token'], 530, 'start')}
${event('again', 62, ['photos load again'], 180, 'start')}
</svg>`;

const storyboard = {
  title: 'How OAuth 2.0 actually works',
  subtitle: 'Letting an app into your photos without giving it your password',
  tones: { good: 'safe: limited, or kept secret', bad: 'exposed: too wide, or leaked' },
  pictures: { account, cast },
  scenes: [
    {
      type: 'svg',
      chapter: 'The bad old days',
      title: 'Alice hands over her password',
      narration: 'Alice wants PrintMyPhotos to print some pictures from her Google account.',
      picture: 'account',
      labels: {
        alice: 'Alice',
        pmp: 'PrintMyPhotos',
        google: 'Google account',
        password: 'password',
        login: 'logs in as Alice',
        others: 'Gmail, Drive and Calendar',
        'warn-db': 'their database',
        'warn-revoke': 'change her password',
        'oauth-q': 'what an app may touch',
      },
      hidden: [
        'password',
        'login',
        'warn-all',
        'warn-db',
        'warn-revoke',
        'oauth-q',
        'pw-google',
        'token-line',
        'one-hour',
      ],
      steps: [
        {
          show: ['password'],
          focus: ['alice', 'password', 'pmp'],
          say: 'Years ago, the only way was to type her real Google password into the app.',
        },
        {
          show: ['login'],
          focus: ['login', 'google'],
          say: 'The app logs in to her Google account, pretending to be her.',
        },
        {
          show: ['warn-all'],
          focus: ['warn-all', 'others'],
          tint: { others: 'bad' },
          say: 'Problem one: it opens everything. The app could read her Gmail and Drive, or delete her photos.',
        },
        {
          show: ['warn-db'],
          focus: 'warn-db',
          say: 'Problem two: her secret now sits in their database. If they get hacked, it leaks.',
        },
        {
          show: ['warn-revoke'],
          focus: 'warn-revoke',
          say: 'Problem three: to cut the app off, she has to change her password, which logs out everything else too.',
        },
        {
          show: ['oauth-q'],
          focus: ['photos', 'oauth-q'],
          draw: [{ circle: 'photos', when: 'just the photos' }],
          say: 'OAuth fixes this. It is about what an app may touch, here just the photos. Not who someone is.',
        },
      ],
    },
    {
      type: 'svg',
      chapter: 'The valet key',
      title: 'Master key or valet key',
      narration: 'Some cars come with two keys. You keep the master key, and you hand the valet a weaker one.',
      svg: valet,
      labels: {
        master: 'master key',
        valet: 'weak one',
        'row-start': 'start the car',
        'row-who': 'borrows',
        'row-trunk': 'trunk or the glove box',
      },
      hidden: ['row-start', 'row-who', 'row-trunk'],
      steps: [
        { show: ['row-start'], focus: 'row-start', say: 'Both keys start the car, so the valet can do the job.' },
        {
          show: ['row-who'],
          focus: ['row-who', 'master', 'valet'],
          say: 'But you keep the master key. The valet only borrows the weak one, for the evening.',
        },
        {
          show: ['row-trunk'],
          focus: 'row-trunk',
          say: 'And it cannot open the trunk or the glove box.',
        },
        {
          focus: 'valet',
          draw: [{ write: 'an OAuth token', near: 'valet', side: 'right', when: 'OAuth token' }],
          say: 'An OAuth token is that valet key.',
        },
      ],
    },
    {
      type: 'svg',
      chapter: 'Four roles',
      title: 'Who plays which part',
      narration: 'OAuth gives each player a name. Here are the four, in Alice’s story and in the car story.',
      picture: 'cast',
      hidden: ['auth', 'app', 'api', 'token', ...caps, ...msgs],
      labels: {
        alice: 'Alice',
        'cap-alice': 'resource owner',
        app: 'PrintMyPhotos',
        'cap-app': 'client',
        auth: 'Google’s sign-in service',
        'cap-auth': 'authorization server',
        api: 'photos API',
        'cap-api': 'resource server',
        token: 'access token',
      },
      steps: [
        {
          show: ['cap-alice'],
          focus: ['alice', 'cap-alice'],
          say: 'The resource owner is Alice. The photos are hers.',
        },
        {
          show: ['app', 'cap-app'],
          focus: ['app', 'cap-app'],
          say: 'The client is PrintMyPhotos, the app that wants in, like the valet.',
        },
        {
          show: ['auth', 'cap-auth'],
          focus: ['auth', 'cap-auth'],
          say: 'The authorization server is Google’s sign-in service. It makes the keys.',
        },
        {
          show: ['api', 'cap-api'],
          focus: ['api', 'cap-api'],
          say: 'The resource server is the photos API, where the photos live. That is the car.',
        },
        {
          show: ['token'],
          focus: 'token',
          say: 'And the access token is the valet key: a pass that opens only the photos, for a short time.',
        },
      ],
    },
    {
      type: 'svg',
      chapter: 'A secret and its hash',
      title: 'PKCE: make a secret, send its hash',
      narration: 'Before anything else, the app makes a secret of its own. This trick is called PKCE, said pixie.',
      svg: pkce,
      labels: { verifier: 'secret', sha: 'hash', bytes: '32 bytes', b64: 'safe text', challenge: 'challenge' },
      hidden: ['bytes', 'b64', 'challenge'],
      steps: [
        {
          focus: 'verifier',
          say: 'It picks forty three random characters, the code verifier, and keeps them secret on the phone.',
        },
        {
          show: ['bytes'],
          focus: ['sha', 'bytes'],
          say: 'It runs that through SHA-256, a hash that cannot be run backwards, and gets thirty two bytes.',
        },
        { show: ['b64'], focus: 'b64', say: 'It writes those bytes as safe text that can go in a web address.' },
        {
          show: ['challenge'],
          focus: 'challenge',
          draw: [
            { write: 'challenge =\nBASE64URL(SHA256(verifier))', near: 'sha', side: 'right', when: 'code challenge' },
          ],
          say: 'That text is the code challenge. It goes out, and only the app knows what made it.',
        },
      ],
    },
    {
      type: 'terminal',
      chapter: 'Asking for access',
      title: 'Step 1: send Alice to the sign-in page',
      window: 'Alice’s browser',
      narration: 'Now the app sends Alice’s browser to the sign-in page, with a few details in the web address.',
      entries: [
        {
          output: [
            'GET https://accounts.example.com/authorize',
            '  ?response_type=code',
            '  &client_id=print_photos_123',
            `  &redirect_uri=${redirect}`,
            '  &scope=photos.read',
            '  &state=xyz_secure_random',
            `  &code_challenge=${challenge}`,
            '  &code_challenge_method=S256',
          ].join('\n'),
        },
      ],
      steps: [
        { focus: ['0:1', '0:2'], say: 'These addresses are made up. It asks for a code, and says which app it is.' },
        { focus: '0:3', say: 'It says where to send Alice back afterwards.' },
        { focus: '0:4', say: 'The scope asks to read photos, and nothing else.' },
        {
          focus: '0:5',
          say: 'The state is a random value the app checks when Alice comes back. It stops another site faking the return trip.',
        },
        { focus: ['0:6', '0:7'], say: 'And here is the challenge, with S256 saying it was made with SHA-256.' },
      ],
    },
    {
      type: 'svg',
      chapter: 'Consent and the code',
      title: 'From consent to tokens',
      narration: 'Here is the whole round trip, from the first hop to the app holding a token.',
      picture: 'cast',
      hidden: ['token', ...caps, ...msgs],
      labels: {
        alice: 'Alice',
        app: 'the app',
        auth: 'sign-in service',
        'm-go': 'sends Alice’s browser',
        'm-authorize': 'challenge',
        'm-consent': 'view her photos',
        'm-allow': 'allow',
        'm-code': 'one-time code',
        'm-callback': 'comes back',
        'm-swap': 'swaps the code',
        'm-tokens': 'tokens',
      },
      steps: [
        {
          show: ['m-go', 'm-authorize'],
          focus: ['m-go', 'm-authorize', 'app', 'auth'],
          say: 'The app sends Alice’s browser to the sign-in service, challenge and all.',
        },
        {
          hide: ['m-go', 'm-authorize'],
          show: ['m-consent', 'm-allow'],
          focus: ['m-consent', 'm-allow', 'alice', 'app'],
          say: 'Alice signs in on Google’s own page, and sees that the app wants to view her photos. She taps allow.',
        },
        {
          hide: ['m-consent', 'm-allow'],
          show: ['m-code', 'm-callback'],
          focus: ['m-code', 'm-callback', 'app'],
          say: 'She comes back to the app with a one-time code. Not the token itself, because web addresses leak.',
        },
        {
          hide: ['m-code', 'm-callback'],
          show: ['m-swap'],
          focus: ['m-swap', 'app'],
          say: 'The app swaps the code for a token in a direct request, and sends the secret along.',
        },
        {
          focus: 'auth',
          draw: [{ write: 'hash(verifier) = challenge?', near: 'auth', side: 'right', when: 'hashes' }],
          say: 'The sign-in service hashes the secret. If it matches the challenge, this is the same app that asked.',
        },
        {
          show: ['m-tokens'],
          focus: 'm-tokens',
          say: 'Then it hands over the tokens. Alice’s password never went near the app.',
        },
      ],
    },
    {
      type: 'terminal',
      chapter: 'The exchange',
      title: 'Step 2: swap the code for tokens',
      window: 'PrintMyPhotos to the sign-in service',
      narration: 'Here is that swap up close: the request the app sends, and the answer it gets.',
      entries: [
        {
          output: [
            'POST https://accounts.example.com/token',
            'Content-Type: application/x-www-form-urlencoded',
            '',
            'grant_type=authorization_code',
            '&code=AUTH_CODE_789',
            `&redirect_uri=${redirect}`,
            '&client_id=print_photos_123',
            `&code_verifier=${verifier}`,
          ].join('\n'),
        },
        {
          output: [
            '[HTTP/1.1 200 OK]{good}',
            '{',
            '  "access_token": "eyJhbGciOi...",',
            '  "token_type": "Bearer",',
            `  "expires_in": ${expiresIn},`,
            '  "refresh_token": "r_99812..."',
            '}',
          ].join('\n'),
        },
      ],
      steps: [
        { focus: ['0:3', '0:4'], say: 'The app hands in the one-time code.' },
        { focus: '0:7', say: 'And the secret itself, the verifier. Only the app that made the challenge knows it.' },
        { focus: ['1:2', '1:3'], say: 'Back comes an access token, the valet key.' },
        { focus: '1:4', say: 'It lasts thirty six hundred seconds, which is one hour.' },
        { focus: '1:5', say: 'And a refresh token, for getting a new key later without bothering Alice.' },
      ],
    },
    {
      type: 'terminal',
      chapter: 'Using the token',
      title: 'Step 3: show the token to the API',
      window: 'PrintMyPhotos to the photos API',
      narration: 'Now the app asks the photos API for Alice’s pictures, and shows the token instead of a password.',
      entries: [
        {
          output: ['GET https://photos.example.com/v1/photos', 'Authorization: Bearer eyJhbGciOi...'].join('\n'),
        },
        {
          output: [
            '[HTTP/1.1 200 OK]{good}',
            '{ "photos": [',
            '  { "id": "p_1", "name": "beach.jpg" },',
            '  { "id": "p_2", "name": "birthday.jpg" }',
            '] }',
          ].join('\n'),
        },
      ],
      steps: [
        { focus: '0:1', say: 'Bearer means whoever holds this token gets in, so it has to be kept safe.' },
        {
          focus: ['1:0', '1:1'],
          say: 'The API checks the token is genuine, not expired, and allowed to read photos. Then it answers.',
        },
      ],
    },
    {
      type: 'svg',
      chapter: 'Expiry and refresh',
      title: 'A token runs out after an hour',
      narration: 'An access token runs out on purpose. Here is what happens over its hour.',
      svg: life,
      labels: {
        first: 'sixty minutes',
        issued: 'token starts',
        works: 'requests still work',
        expired: 'four oh one, unauthorized',
        refresh: 'refresh token',
        second: 'fresh access token',
        again: 'never sees a thing',
      },
      hidden: ['first', 'second', 'works', 'expired', 'refresh', 'again'],
      steps: [
        { show: ['first'], focus: ['issued', 'first'], say: 'The token starts its sixty minutes.' },
        { show: ['works'], focus: 'works', say: 'Half an hour in, requests still work.' },
        {
          show: ['expired'],
          focus: 'expired',
          draw: [{ circle: 'expired', when: 'says no' }],
          say: 'At sixty minutes the API says no: four oh one, unauthorized.',
        },
        {
          show: ['refresh', 'second'],
          focus: ['refresh', 'second'],
          say: 'The app sends its refresh token to the sign-in service and gets a fresh access token.',
        },
        {
          show: ['again'],
          focus: 'again',
          say: 'Alice never sees a thing. And if a token leaks, it stops working within the hour.',
        },
      ],
    },
    {
      type: 'svg',
      chapter: 'The whole loop',
      title: 'Authorization Code Flow with PKCE',
      narration: 'Let’s put the whole thing together.',
      picture: 'cast',
      hidden: ['token', ...caps, ...msgs],
      labels: {
        'm-allow': 'says yes',
        'm-code': 'one-time code',
        'm-callback': 'comes back',
        'm-swap': 'swaps the code',
        'm-tokens': 'tokens',
        'm-bearer': 'shows the token',
        'm-photos': 'photos',
      },
      steps: [
        {
          show: ['m-allow'],
          focus: 'm-allow',
          say: 'Alice says yes, on the provider’s page, to just what the app needs.',
        },
        {
          show: ['m-code', 'm-callback'],
          focus: ['m-code', 'm-callback'],
          say: 'She comes back with a one-time code.',
        },
        {
          show: ['m-swap', 'm-tokens'],
          focus: ['m-swap', 'm-tokens'],
          say: 'The app swaps the code and its secret for tokens.',
        },
        {
          show: ['m-bearer', 'm-photos'],
          focus: ['m-bearer', 'm-photos'],
          say: 'And it shows the token to fetch the photos.',
        },
      ],
    },
    {
      type: 'svg',
      chapter: 'Why it is safer',
      title: 'The app gets a small key that runs out',
      narration: 'So, compared with the bad old days.',
      picture: 'account',
      hidden: [
        'password',
        'login',
        'warn-all',
        'warn-db',
        'warn-revoke',
        'oauth-q',
        'pw-google',
        'token-line',
        'one-hour',
      ],
      labels: { 'pw-google': 'password', 'token-line': 'just the photos', 'one-hour': 'an hour', photos: 'photos' },
      steps: [
        {
          show: ['pw-google'],
          focus: 'pw-google',
          say: 'Alice’s password only goes to Google, never to the app.',
        },
        {
          show: ['token-line'],
          tint: { photos: 'good' },
          focus: ['token-line', 'photos'],
          say: 'The app asks for just the photos.',
        },
        { show: ['one-hour'], focus: 'one-hour', say: 'Its key runs out after an hour.' },
        {
          focus: 'token-line',
          draw: [{ cross: 'token-line', when: 'cut the app off' }],
          say: 'And Alice can cut the app off in one click, without changing her password.',
        },
      ],
    },
  ],
};

fs.writeFileSync(new URL('./storyboard.json', import.meta.url), JSON.stringify(storyboard, null, 2) + '\n');
fs.writeFileSync(new URL('./hunks.json', import.meta.url), '{}\n');
fs.writeFileSync(new URL('./meta.json', import.meta.url), JSON.stringify({ mode: 'explain' }, null, 2) + '\n');
