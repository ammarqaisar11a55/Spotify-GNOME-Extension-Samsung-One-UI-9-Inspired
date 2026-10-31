UUID := spotify-oneui@ammarqaisar11a55.github.io
DIST := dist
PACK := $(DIST)/$(UUID).shell-extension.zip

.PHONY: all schemas pack install uninstall test clean

all: pack

schemas:
	glib-compile-schemas --strict schemas/

pack:
	mkdir -p $(DIST)
	gnome-extensions pack . --force --out-dir=$(DIST) \
		--extra-source=src --extra-source=icons

install: pack
	gnome-extensions install --force $(PACK)
	@echo "Installed. Log out and back in, then run: gnome-extensions enable $(UUID)"

uninstall:
	gnome-extensions uninstall $(UUID)

test: pack
	bash tests/run-headless.sh

clean:
	rm -rf $(DIST) schemas/gschemas.compiled
