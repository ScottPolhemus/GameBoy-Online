import localforage from 'localforage'
import { debounce } from 'lodash'

import Core from './core'
import { cout } from './terminal'
import settings from './settings'

localforage.config({
  name: 'gamer-pocket',
  storeName: 'games'
})

export default class GameBoyPlayer {
  constructor(canvas, {
    mediaStreamWorkerSrc = '',
    soundVolume,
  } = {}) {
    this.core = new Core({
      canvas,
      loadSRAM: this.loadSRAM,
      loadRTC: this.loadRTC,
      mediaStreamWorkerSrc,
      pause: this.pause.bind(this),
      soundVolume: typeof soundVolume === `undefined` ? settings.soundVolume : soundVolume,
    })
    this.runInterval = null

    this.core.events.on('ramWrite', debounce(this.autoSave.bind(this), 100))
  }

  async openROM(ROMImage) {
    await this.core.openROM(ROMImage)
  }

  start() {
    this.clearLastEmulation()
    this.core.initLCD();
    this.core.initSound();
    this.run()
  }

  run() {
    if (!this.core.playing) {
      this.core.stopEmulator &= 1;
      cout("Starting the iterator.", 0);
      var dateObj = new Date();
      this.core.firstIteration = dateObj.getTime();
      this.core.iterations = 0;
      this.runInterval = setInterval(() => {
        if (!document.hidden && !document.msHidden && !document.mozHidden && !document.webkitHidden) {
          this.core.run();
        }
      }, settings.runInterval);
    } else {
      cout("The GameBoy core is already running.", 1);
    }
  }

  async pause() {
    if (this.core.playing) {
      await this.autoFreeze();
      this.clearLastEmulation();
    } else {
      cout("GameBoy core has already been paused.", 1);
    }
  }

  resume(freezeState) {
    this.clearLastEmulation()

    if (freezeState) {
      try {
        cout("Attempting to run a saved emulation state.", 0)
        this.core.openFreezeState(freezeState)
      } catch (error) {
        cout(error.message + " file: " + error.fileName + " line: " + error.lineNum, 1);
      }
    }

    this.run()
  }

  clearLastEmulation() {
    if (this.core.playing) {
      clearInterval(this.runInterval);
      this.core.stopEmulator |= 2;
      cout("The previous emulation has been cleared.", 0);
    } else {
      cout("No previous emulation was found to be cleared.", 0);
    }
  }

  async autoSave() {
    cout("Automatically saving the SRAM.", 0);
    await Promise.all([
      this.saveSRAM(this.core.name, this.core.SRAMState),
      this.saveRTC(this.core.name, this.core.RTCState),
    ])
  }

  async autoFreeze() {
    cout("Automatically saving freeze state.", 0);
    await Promise.all([
      this.saveFreeze(this.core.name, this.core.freezeState),
      this.saveFreezeScreen(this.core.name, this.core.screenshot)
    ])
  }

  setVolume(volume) {
    this.core.changeVolume(volume)
  }

  saveROM(name, ROMImage) {
    return localforage.setItem(`ROM_${name}`, ROMImage)
  }

  loadROM(name) {
    return localforage.getItem(`ROM_${name}`)
  }

  saveSRAM(name, SRAMState) {
    return localforage.setItem(`SRAM_${name}`, SRAMState)
  }

  loadSRAM(name) {
    return localforage.getItem(`SRAM_${name}`)
  }

  saveRTC(name, RTCState) {
    return localforage.setItem(`RTC_${name}`, RTCState)
  }

  loadRTC(name) {
    return localforage.getItem(`RTC_${name}`)
  }

  saveFreeze(name, freezeState) {
    return localforage.setItem(`FREEZE_${name}`, freezeState)
  }

  loadFreeze(name) {
    return localforage.getItem(`FREEZE_${name}`)
  }

  saveFreezeScreen(name, freezeScreen) {
    return localforage.setItem(`FREEZESCREEN_${name}`, freezeScreen)
  }

  loadFreezeScreen(name) {
    return localforage.getItem(`FREEZESCREEN_${name}`)
  }

  getStorageKeys() {
    return localforage.keys()
  }

  buttonDown(button) {
    if (this.core.playing) {
      this.core.JoyPadEvent(this.getButtonIndex(button), true)
    }
  }

  buttonUp(button) {
    if (this.core.playing) {
      this.core.JoyPadEvent(this.getButtonIndex(button), false)
    }
  }

  getButtonIndex(button) {
    var buttonMap = ["right", "left", "up", "down", "a", "b", "select", "start"]
    for (var index = 0; index < buttonMap.length; index++) {
      if (buttonMap[index] == button) {
        return index;
      }
    }
    return -1;
  }
}
