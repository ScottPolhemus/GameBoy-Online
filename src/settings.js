//  Some settings.
export default {
  soundOn: true, // Turn on sound.
  bootBootRomFirst: true, // Boot with boot ROM first?
  gbHasPriority: false, // Give priority to GameBoy mode
  soundVolume: 0.5, // Volume level set.
  colorizeGBMode: true, // Colorize GB mode?
  runInterval: 8, // Interval for the emulator loop.
  audioBufferMinSpan: 10, // Audio buffer minimum span amount over x interpreter iterations.
  audioBufferMaxSpan: 20, // Audio buffer maximum span amount over x interpreter iterations.
  alwaysAllowMBC1: false, // Override to allow for MBC1 instead of ROM only (compatibility for broken 3rd-party cartridges).
  alwaysAllowRWtoBanks: false, // Override MBC RAM disabling and always allow reading and writing to the banks.
  forceGBBootRom: false, // Use the GameBoy boot ROM instead of the GameBoy Color boot ROM.
  enabledChannels: [true, true, true, true] // User controlled channel enables.
}
