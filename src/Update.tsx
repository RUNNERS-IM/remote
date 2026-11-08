// The update window is runners-app-kit's RunnersUpdate, connected here to this app's main process.
import { RunnersUpdate, type RunnersUpdateProps } from "./runners-account/runners-update";
import { t } from "./i18n";
import { answerUpdate, fitHeight, onUpdateOffer, updateOffer } from "./native";
import appIcon from "./assets/app-icon.png";
import "./App.css";

const updateT: RunnersUpdateProps["t"] = (key, args) => t(key as Parameters<typeof t>[0], args);

export default function Update() {
  return (
    <RunnersUpdate
      appIcon={appIcon}
      t={updateT}
      offer={updateOffer}
      onOffer={onUpdateOffer}
      answer={answerUpdate}
      fitHeight={fitHeight}
    />
  );
}
