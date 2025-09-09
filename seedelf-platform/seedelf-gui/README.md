# Seedelf-gui

**early alpha**

A simple light desktop wallet for Seedelf. The goal is basic cli functionality in gui form. New features will be added over time.

## Setup 

Install dependencies.
```bash
npm install
```

Install tauri cli
```bash
cargo install create-tauri-app --locked
```

Running the application locally.

```bash
cargo tauri dev
```

Building the application.
```bash
npm run tauri build
```

## Formatting

format all the ts and tsx
```bash
npx prettier --write "src/**/*.{ts,tsx}"
```

## Known Issues

- Blank screen on GUI: force server to restart/reload
- Local webserver is already running: stop webserver process