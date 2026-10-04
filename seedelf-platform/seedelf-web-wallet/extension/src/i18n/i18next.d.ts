// Keys are flat dot-notation, and `t()` is typed against en.json: a key that
// doesn't exist, or one spelled wrong, is a compile error rather than a screen
// that says "receive.title". Without `keySeparator: false` here the typed t()
// splits every key on its dots and infers `never`.

import type { bundles } from "./translations";

declare module "i18next" {
  interface CustomTypeOptions {
    keySeparator: false;
    nsSeparator: false;
    defaultNS: "translation";
    resources: {
      translation: (typeof bundles)["en"];
    };
  }
}
