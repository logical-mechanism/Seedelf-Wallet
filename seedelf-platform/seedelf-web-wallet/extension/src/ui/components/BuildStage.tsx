// What a build is doing, under the button that started it. The worker reports
// each stage on the request's own port (background/ui-port.ts); without it the
// wallet only greys the button out, and a build that reads the chain, builds
// and measures scripts looks the same as one that has hung.

import { useEffect, useState } from "react";
import { useT, type I18nKey } from "../../i18n";

import type { BuildStage as Stage } from "../../shared/rpc";
import { buildStage, onBuildStage } from "../background";

/** What each stage is called on screen, in the order they happen. */
const WORDS: Record<Stage, I18nKey> = {
  checking: "buildStage.checking",
  reading: "buildStage.reading",
  building: "buildStage.building",
  measuring: "buildStage.measuring",
  collateral: "buildStage.collateral",
};

/** The running build's stage, or undefined between builds. */
export function useBuildStage(): Stage | undefined {
  const [stage, setStage] = useState<Stage | undefined>(buildStage);
  useEffect(() => onBuildStage(setStage), []);
  return stage;
}

/** A quiet line saying what the build is doing; nothing at all when none is. */
export function BuildStage({ busy }: { busy: boolean }) {
  const t = useT();
  const stage = useBuildStage();
  if (!busy || !stage) return null;
  return (
    <p className="note center build-stage" data-testid="build-stage" aria-live="polite">
      {t(WORDS[stage])}
    </p>
  );
}
