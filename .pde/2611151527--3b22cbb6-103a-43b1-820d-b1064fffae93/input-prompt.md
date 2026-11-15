# Make @gerico1007/termux-init useful to someone brand new, before it is published on npm

## The person's words (Jerry, 2026-11-15)

> Okay, and I want to be sure that it will be useful when someone installs it. So imagine someone brand new open a computer and install this package. It will permit to create a registry. So it will ask the name of the device that will write that somewhere. The SSH key will be copied at the right place. All the name of the other device will be registered too. So you need to select if this is the host or if this is some device, Android or other, I don't know. I think the package not quite ready, don't you think? Try to analyze the state of Thermix in it and in which way someone brand new, never used Tailscale, gonna be able to, you know, download the appropriate package Tailscales. Maybe we can join it in the NPM as requirement, and a page that will explain how to create an account or how to log into his account to get it started. And if we install it and we already are connected, it will run a command to see if we are connected in the current computer, and if the command tailscale terminal command say that we are connected, it will show something different, you know. So I need to ameliorate that package before publishing to NPM, and of course removing my personal data. You can do it in a new issue if needed. Be sure that nothing is compromising for me.

## Current reality (verified 2026-11-15 on termux-init 0.3.1, main 43355e5)

- The package ships three commands: `termux-init` (sets up a device), `forest-registry` (the SSH key registry server, port 8773), `forest-status` (SSH check of every registered node).
- `termux-init` exits on anything that is not Termux (`bin/termux-init.js:286-287`). A computer (Linux, macOS) cannot join the mesh with it.
- Device name: `--hostname` flag, else the SSH key comment, else `os.hostname()` (`localhost` on Termux). There is no prompt and nothing is saved as the device's chosen name.
- There is no role choice (registry host vs device). The registry host is set up by hand: no command installs or starts `systemd/forest-registry.service`.
- Defaults point at the author's own network: the registry URL `http://eury.<author-tailnet>.ts.net:8773`, the `~/.ssh/config` Host blocks (`<host>.<author-tailnet>.ts.net`, `User gmusic`), the registry `seed` list of the author's four phones, the README table of the author's devices with their Tailscale addresses, and an author email in `package.json` that is not the author's.
- Tailscale: on Termux there is no `tailscale` CLI (the Android app owns it); the phone's 100.x address is visible with `ifconfig`. On a computer, `tailscale status --json` gives `BackendState` (`Running` when connected), the tailnet and the device's DNS name. `termux-init` never checks whether Tailscale is installed or connected.
- Tailscale cannot be an npm dependency: it is a system app or daemon, not a Node package.
- The registry has no authentication: any device inside the tailnet can register a key, and nodes trust every key in `/keys`.
- Gerico1007/termux-init#2 (configurable defaults) has branch `2-forest-configurable-defaults` with `FOREST_TAILNET`, `FOREST_REGISTRY_HOST`, `FOREST_SEED_NODES`.
- On the author's phones gmtermux owns `~/.bashrc`; since 0.3.0 termux-init leaves it alone by default (Gerico1007/termux-init#4).
- No secrets are in the package; `npm audit` reports 0 vulnerabilities; no install scripts.
