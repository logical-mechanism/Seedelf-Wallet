# Seedelf-gui

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

format all the ts and tsx
```bash
npx prettier --write "src/**/*.{ts,tsx}"
```
### Issues

- Blank screen on GUI, force server to restart/reload.