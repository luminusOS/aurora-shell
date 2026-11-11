%global uuid aurora-shell@luminusos.github.io
%global extdir %{_datadir}/gnome-shell/extensions/%{uuid}

Name:           gnome-shell-extension-aurora-shell
Version:        51.1
Release:        1%{?dist}
Summary:        Aurora Shell, a customizable extension for GNOME Shell
License:        GPL-3.0-or-later
URL:            https://github.com/luminusOS/aurora-shell
Source0:        %{url}/releases/download/v%{version}/%{uuid}.shell-extension.zip
BuildArch:      noarch
BuildRequires:  unzip
BuildRequires:  glib2-devel
Supplements:    gnome-shell

%description
Aurora Shell adds the Luminus OS dock, menu and desktop modules to GNOME Shell.
This package installs the release extension system-wide.

%prep
%setup -q -c -n %{name}-%{version}

%build
glib-compile-schemas schemas

%install
install -d %{buildroot}%{extdir}
cp -a . %{buildroot}%{extdir}
rm -f %{buildroot}%{extdir}/LICENSE
find %{buildroot}%{extdir} -type d -exec chmod 0755 {} +
find %{buildroot}%{extdir} -type f -exec chmod 0644 {} +

%files
%license LICENSE
%{extdir}

%changelog
* Wed Nov 11 2026 Luminus OS <noreply@luminusos.org> - 51.1-1
- Package the 51.1 release extension for the Luminus RPM repository
