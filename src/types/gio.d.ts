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
    }
  }
}
