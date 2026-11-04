# Android rear camera

This is a mobile web interface, not a signed APK. The camera requires browser
permission and a secure context. For a USB-connected development device, localhost
can be forwarded through Android Debug Bridge:

```sh
npm run build:phone
npm run demo:phone
adb reverse tcp:7447 tcp:7447
```

On the phone, open http://127.0.0.1:7447/mobile in Chrome. Tap Open camera,
grant permission, then Start scan. Hold a view steady for a few seconds and tap
Done. Captures stay in ignored `data/phone-preview/`. Recognition is disabled in
this capture-only launcher. No personal photos are provided with the project.

USB debugging and host authorization must already be enabled. `adb` is a separate
Android platform-tools installation. Use `PHONE_CAMERA_WORKSPACE` to choose a
separate workspace and `PHONE_CAMERA_DIST_DIR` to choose another built client.

The live model demo launcher is a separate, explicitly budgeted configuration.
Building the camera client alone does not authorize or enable API calls.
To return to the virtual workshop, run `npm run build:demo` again.
