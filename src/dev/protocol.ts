export const DEVTOOL_PATH = '/org/gnome/Shell/Extensions/AuroraShell/DevTool';
export const DEVTOOL_INTERFACE = 'org.gnome.Shell.Extensions.AuroraShell.DevTool';
export const DEVTOOL_XML = `<node><interface name="${DEVTOOL_INTERFACE}">
  <signal name="LaunchRequested"/>
  <method name="TakeLaunchRequest"><arg direction="out" type="b"/></method>
  <method name="Describe"><arg direction="out" type="s"/></method>
  <method name="Run"><arg direction="in" type="s"/><arg direction="in" type="s"/></method>
</interface></node>`;

export interface ActionInfo {
  id: string;
  label: string;
  disabled: boolean;
  active: boolean;
}
export interface ToolInfo {
  key: string;
  title: string;
  details: string[];
  actions: ActionInfo[];
}
export interface RuntimeAction extends ActionInfo {
  run(): unknown;
}
export function action(
  id: string,
  label: string,
  run: () => unknown,
  disabled = false,
  active = false,
): RuntimeAction {
  return { id, label, run, disabled, active };
}
