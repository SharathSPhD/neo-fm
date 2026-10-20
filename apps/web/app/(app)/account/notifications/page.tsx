/** /account/notifications -- per-type preferences and web push opt-in. */
import { NotificationSettings } from "./settings";

export const dynamic = "force-dynamic";

export default function NotificationSettingsPage() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <header className="flex flex-col gap-1.5">
        <h1 className="text-3xl font-medium tracking-tight">Notifications</h1>
        <p className="text-sm text-foreground/60">
          Choose what shows up in the bell and what can reach this device as a push notification.
        </p>
      </header>
      <NotificationSettings />
    </div>
  );
}
