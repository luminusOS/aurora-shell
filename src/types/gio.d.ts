declare module '@girs/gio-2.0/gio-2.0' {
  namespace Gio {
    interface DBusConnection {
      own_name(
        name: string,
        flags: BusNameOwnerFlags,
        nameAcquired: BusNameAcquiredCallback | null,
        nameLost: BusNameLostCallback | null,
      ): number;
      watch_name(
        name: string,
        flags: BusNameWatcherFlags,
        nameAppeared: BusNameAppearedCallback | null,
        nameVanished: BusNameVanishedCallback | null,
      ): number;
      // GNOME Shell promisifies this method at startup (js/ui/environment.js).
      call(
        busName: string,
        objectPath: string,
        interfaceName: string,
        methodName: string,
        parameters: GLib.Variant | null,
        replyType: GLib.VariantType | null,
        flags: DBusCallFlags,
        timeoutMsec: number,
        cancellable: Cancellable | null,
      ): Promise<GLib.Variant>;
    }
  }
}
