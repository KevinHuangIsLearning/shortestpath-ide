# Dark Reader native dark theme detector

`src/` contains unchanged official Dark Reader 4.9.133
`src/inject/detector.ts`, its utility dependencies, and definitions. The build
bundles them into the isolated-world preload and preserves the MIT license
in its banner and in `LICENSE`. The upstream API npm build does not
include this detector. No site-specific detector hints are bundled.

Source: <https://github.com/darkreader/darkreader/tree/v4.9.133>

To regenerate, unpack the official v4.9.133 source archive and run from the IDE
repository root:

```sh
node build/next/vendorDarkReaderDetector.ts /path/to/darkreader-4.9.133
```

Ordinary IDE builds use the checked-in TypeScript sources and require no network download.
