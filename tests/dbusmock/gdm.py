BUS_NAME = "org.gnome.DisplayManager"
MAIN_OBJ = "/org/gnome/DisplayManager/Manager"
MAIN_IFACE = "org.gnome.DisplayManager.Manager"
SYSTEM_BUS = True


def load(mock, _parameters):
    mock.AddProperty(MAIN_IFACE, "Version", "50.0")
    mock.AddMethods(
        MAIN_IFACE,
        [
            ("RegisterSession", "", "", ""),
            ("RegisterDisplay", "", "", ""),
        ],
    )
