import { useState } from "react";
import { WebServerModal } from "@/components/WebServerModal";
import { TextField } from "@/components/TextField";
import {
  ShowNotification,
  NotificationVariant,
} from "@/components/ShowNotification";
import { IntegerField } from "@/components/IntegerField";

export function Fund() {
  const [message, setMessage] = useState<string | null>(null);
  const [variant, setVariant] = useState<NotificationVariant>("error");

  const [address, setAddress] = useState("");
  const [seedelf, setSeedelf] = useState("");
  const [lovelace, setLovelace] = useState(0);

  const [showWebServerModal, setShowWebServerModal] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState(false);

  return (
    <div className="w-full p-6">
      <h1 className="text-xl font-semibold text-center">Fund A Seedelf</h1>

      <ShowNotification
        message={message}
        setMessage={setMessage}
        variant={variant}
      />

      <WebServerModal
          open={showWebServerModal} 
          url={"http://127.0.0.1:44203/"} 
          onClose={() => {
            setVariant("info");
            setMessage("Stopping Web Server..");
            setShowWebServerModal(false)
          }}
        />

        <div className="my-4 max-w-5/8 mx-auto w-full">
          <TextField
            label="Address"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            disabled={submitting}
            maxLength={108}
          />
        </div>

        <div className="my-4 max-w-5/8 mx-auto w-full">
          <TextField
            label="Seedelf"
            value={seedelf}
            onChange={(e) => setSeedelf(e.target.value)}
            disabled={submitting}
            maxLength={64}
            minLength={64}
          />
        </div>

        <div className="my-4 max-w-5/8 mx-auto w-full">
          <IntegerField
            label="Lovelace"
            value={lovelace}
            onChange={setLovelace}
            min={0}
          />
        </div>
    </div>
  );
}
