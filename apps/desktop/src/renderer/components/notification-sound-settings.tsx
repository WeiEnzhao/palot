import { Play, Volume2 } from "lucide-react";
import { useAtom, useAtomValue } from "jotai";
import type { DesktopNotificationDeliveryStatus } from "../../shared";
import {
  desktopNotificationSettingsAtom,
  notificationSoundPreferencesAtom,
} from "../atoms/notification-sounds";
import {
  NOTIFICATION_SOUND_EVENTS,
  NOTIFICATION_SOUND_OPTIONS,
  notificationSoundsEnabled,
  playNotificationSound,
  type NotificationSoundChoice,
  type NotificationSoundID,
} from "../lib/notification-sounds";
import { Button } from "./ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { SettingsGroup, SettingsRow, SettingsSection } from "./settings-layout";

const SOUND_LABELS: Record<NotificationSoundChoice, string> = {
  off: "关闭",
  ...(Object.fromEntries(NOTIFICATION_SOUND_OPTIONS.map(({ id, label }) => [id, label])) as Record<
    NotificationSoundID,
    string
  >),
};

export function NotificationSoundSettings({
  deliveryStatus,
  play = playNotificationSound,
}: {
  /** macOS delivery status, when Palot has already read it. */
  deliveryStatus: DesktopNotificationDeliveryStatus | null;
  play?: (sound: NotificationSoundID) => void;
}) {
  const [preferences, setPreferences] = useAtom(notificationSoundPreferencesAtom);
  const desktopSettings = useAtomValue(desktopNotificationSettingsAtom);
  const alertsOff =
    deliveryStatus?.authorization === "denied" || deliveryStatus?.delivery === "off";

  return (
    <SettingsSection
      title="声音"
      description={
        desktopSettings?.turnCompletion === "unfocused"
          ? "任务完成或需要您时播放简短提示音。仅在 Palot 处于后台时播放，与任务完成通知一致。"
          : "任务完成或需要您时播放简短提示音。"
      }
      icon={Volume2}
    >
      {alertsOff && notificationSoundsEnabled(preferences) ? (
        <p role="note" className="text-compact text-muted-foreground">
          macOS 已关闭 Palot 的通知提醒，因此这些事件仅播放声音。
        </p>
      ) : null}
      <SettingsGroup>
        {NOTIFICATION_SOUND_EVENTS.map((event) => {
          const choice = preferences[event.id];
          return (
            <SettingsRow
              key={event.id}
              title={event.label}
              description={event.description}
              control={
                <>
                  <Select
                    value={choice}
                    onValueChange={(value) =>
                      setPreferences((current) => ({
                        ...current,
                        [event.id]: value as NotificationSoundChoice,
                      }))
                    }
                  >
                    <SelectTrigger
                      className="w-full @lg/settings:w-32"
                      aria-label={`${event.label} 声音`}
                    >
                      <SelectValue>{SOUND_LABELS[choice]}</SelectValue>
                    </SelectTrigger>
                    <SelectContent align="end">
                      <SelectItem value="off">关闭</SelectItem>
                      {NOTIFICATION_SOUND_OPTIONS.map((option) => (
                        <SelectItem key={option.id} value={option.id}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`播放 ${event.label.toLowerCase()} 声音`}
                    title="播放声音"
                    disabled={choice === "off"}
                    onClick={() => {
                      if (choice !== "off") play(choice);
                    }}
                  >
                    <Play aria-hidden="true" />
                  </Button>
                </>
              }
            />
          );
        })}
      </SettingsGroup>
    </SettingsSection>
  );
}
