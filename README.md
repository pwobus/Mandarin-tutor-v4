# File: README.md

# Huayu Buddy — Chinese Conversation Tutor

A Mandarin conversation web app with:
- Spoken tutor replies (OpenAI TTS) and optional browser TTS fallback
- Head-only 3D avatar with lip-sync (Viseme) + blinking
- Pinyin + Hanzi display, optional English translation
- Selectable HSK 1-5 vocabulary and review table
- Health checks & diagnostics
- Optional WebRTC realtime chat panel with gpt-4o realtime preview or the lighter `gpt-realtime-mini`

---

## 1) Quick Start
Make sure nodemon is installed:
- npm install -g nodemon
 
OPENAI_API_KEY=sk- npm run dev

---

## 2) Realtime (WebRTC) panel

Use the **Realtime (beta)** panel in the tutor sidebar to try OpenAI's WebRTC streaming experience.

* Click **Connect** to request an ephemeral session token from `/api/realtime-session` and establish the peer connection.
* Enable the **gpt-realtime-mini** toggle to switch the session setup to the lighter-weight `gpt-realtime-mini` API. The UI automatically disables voice selection because mini does not accept a custom voice payload.
* Leave the toggle off to keep using the default realtime preview models (gpt-4o mini/standard) and selectable voices.
* Push-to-talk controls whether the microphone track is live once connected.

> The checkbox persists in `localStorage`, so your last-used setting sticks across reloads. Disconnect before flipping the toggle or changing models.

---

## 3) Electron Desktop App

The project now ships with an Electron wrapper that bundles both the React UI and the Express API into a single desktop executable.

### Local development

```bash
# Starts CRA on :3000, the API on :8787, then launches Electron once both are ready
OPENAI_API_KEY=sk- npm run electron:dev
```

> **Headless / CI environments**
>
> When `DISPLAY`/`WAYLAND_DISPLAY` are missing (for example, on remote Linux containers or CI runners) the dev script automatically skips launching the Electron shell and falls back to the browser + API servers only. Set `ELECTRON_DEV_SKIP=0` if you still want to attempt launching Electron, or `ELECTRON_DEV_SKIP=1` to force skipping regardless of the environment.

### Test the packaged experience without building an installer

```bash
# Builds the React app and starts Electron against the embedded Express server
OPENAI_API_KEY=sk- npm run electron:start
```

### Produce a portable Windows `.exe`

```bash
# Runs `react-scripts build` and then packages a Portable (.exe) build into dist/
OPENAI_API_KEY=sk- npm run electron:build
```

The resulting executable lives in `dist/HuayuBuddy-<version>.exe`. It runs without a console window and starts an internal Express server bound to `127.0.0.1` so no additional services are required.

> **Notes**
>
> * `electron:build` targets a portable Windows binary. When run on non-Windows hosts it may require Wine; running the command on Windows avoids that requirement.
> * The packaged backend expects `OPENAI_API_KEY` (and optional model overrides) to be present in the launching environment—set them before opening the app.
> * On Linux the dev shell disables Electron's sandbox automatically so that local runs don't require `chrome-sandbox` to be installed with setuid permissions.

