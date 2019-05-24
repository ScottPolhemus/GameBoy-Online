import Resampler from './resampler'

// 2010-2013 Grant Galitz - XAudioJS realtime audio output compatibility library

let XAudioJSWebAudioContextHandle = null;
let XAudioJSWebAudioAudioNode = null;
let XAudioJSWebAudioWatchDogTimer = null;
let XAudioJSWebAudioWatchDogLast = false;
let XAudioJSWebAudioLaunchedContext = false;
let XAudioJSAudioContextSampleBuffer = [];
let XAudioJSResampledBuffer = [];
let XAudioJSMinBufferSize = 15000;
let XAudioJSMaxBufferSize = 25000;
let XAudioJSChannelsAllocated = 1;
let XAudioJSVolume = 1;
let XAudioJSResampleControl = null;
let XAudioJSAudioBufferSize = 0;
let XAudioJSResampleBufferStart = 0;
let XAudioJSResampleBufferEnd = 0;
let XAudioJSResampleBufferSize = 0;
let XAudioJSMediaStreamWorker = null;
let XAudioJSMediaStreamBuffer = [];
let XAudioJSMediaStreamSampleRate = 44100;
let XAudioJSMozAudioSampleRate = 44100;
let XAudioJSSamplesPerCallback = 2048; //Has to be between 2048 and 4096 (If over, then samples are ignored, if under then silence is added).
let XAudioJSMediaStreamLengthAliasCounter = 0;

class XAudioServer {
  constructor(
    channels,
    sampleRate,
    minBufferSize,
    maxBufferSize,
    underRunCallback,
    volume,
    failureCallback,
    mediaStreamWorkerSrc
  ) {
    XAudioJSChannelsAllocated = Math.max(channels, 1);
    this.XAudioJSSampleRate = Math.abs(sampleRate);
    XAudioJSMinBufferSize = (minBufferSize >= (XAudioJSSamplesPerCallback * XAudioJSChannelsAllocated) && minBufferSize < maxBufferSize) ? (minBufferSize & (-XAudioJSChannelsAllocated)) : (XAudioJSSamplesPerCallback * XAudioJSChannelsAllocated);
    XAudioJSMaxBufferSize = (Math.floor(maxBufferSize) > XAudioJSMinBufferSize + XAudioJSChannelsAllocated) ? (maxBufferSize & (-XAudioJSChannelsAllocated)) : (XAudioJSMinBufferSize * XAudioJSChannelsAllocated);
    this.underRunCallback = (typeof underRunCallback == "function") ? underRunCallback : function () {};
    XAudioJSVolume = (volume >= 0 && volume <= 1) ? volume : 1;
    this.failureCallback = (typeof failureCallback == "function") ? failureCallback : function () {
      throw new Error("XAudioJS has encountered a fatal error.");
    };

    try {
      this.initializeMozAudio();
    } catch (error) {
      try {
        this.initializeWebAudio();
      } catch (error) {
        try {
          this.initializeMediaStream(mediaStreamWorkerSrc);
        } catch (error) {
          this.audioType = -1;
          this.failureCallback();
        }
      }
    }
  }

  changeVolume(volume) {
    if (volume >= 0 && volume <= 1) {
      XAudioJSVolume = volume;
      switch (this.audioType) {
        case 0:
          this.audioHandleMoz.volume = XAudioJSVolume;
        case 1:
          break;
        case 2:
          this.audioHandleMediaStream.volume = XAudioJSVolume;
          break;
        default:
          this.failureCallback();
      }
    }
  }

  initializeMediaStream(mediaStreamWorkerSrc) {
    if (!mediaStreamWorkerSrc) {
      throw new Error("XAudioJS tried to initialize media stream audio without worker src.");
    }

    this.audioHandleMediaStream = new Audio();
    this.resetCallbackAPIAudioBuffer(XAudioJSMediaStreamSampleRate);
    if (XAudioJSMediaStreamWorker) {
      //WebWorker is not GC'd, so manually collect it:
      XAudioJSMediaStreamWorker.terminate();
    }
    XAudioJSMediaStreamWorker = new Worker(mediaStreamWorkerSrc);
    this.audioHandleMediaStreamProcessing = new ProcessedMediaStream(XAudioJSMediaStreamWorker, XAudioJSMediaStreamSampleRate, XAudioJSChannelsAllocated);
    this.audioHandleMediaStream.src = this.audioHandleMediaStreamProcessing;
    this.audioHandleMediaStream.volume = XAudioJSVolume;
    XAudioJSMediaStreamWorker.onmessage = XAudioJSMediaStreamPushAudio;
    XAudioJSMediaStreamWorker.postMessage([1, XAudioJSResampleBufferSize, XAudioJSChannelsAllocated]);
    this.audioHandleMediaStream.play();
    this.audioType = 2;
  }

  initializeMozAudio() {
    this.audioHandleMoz = new Audio();
    this.audioHandleMoz.mozSetup(XAudioJSChannelsAllocated, XAudioJSMozAudioSampleRate);
    this.audioHandleMoz.volume = XAudioJSVolume;
    this.samplesAlreadyWritten = 0;
    this.audioType = 0;
    //if (navigator.platform != "MacIntel" && navigator.platform != "MacPPC") {
    //Add some additional buffering space to workaround a moz audio api issue:
    var bufferAmount = (this.XAudioJSSampleRate * XAudioJSChannelsAllocated / 10) | 0;
    bufferAmount -= bufferAmount % XAudioJSChannelsAllocated;
    this.samplesAlreadyWritten -= bufferAmount;
    //}
    this.initializeResampler(XAudioJSMozAudioSampleRate);
  }

  initializeWebAudio() {
    if (!XAudioJSWebAudioLaunchedContext) {
      try {
        XAudioJSWebAudioContextHandle = new AudioContext(); //Create a system audio context.
      } catch (error) {
        XAudioJSWebAudioContextHandle = new webkitAudioContext(); //Create a system audio context.
      }
      XAudioJSWebAudioLaunchedContext = true;
    }
    if (XAudioJSWebAudioAudioNode) {
      XAudioJSWebAudioAudioNode.disconnect();
      XAudioJSWebAudioAudioNode.onaudioprocess = null;
      XAudioJSWebAudioAudioNode = null;
    }
    try {
      XAudioJSWebAudioAudioNode = XAudioJSWebAudioContextHandle.createScriptProcessor(XAudioJSSamplesPerCallback, 0, XAudioJSChannelsAllocated); //Create the js event node.
    } catch (error) {
      XAudioJSWebAudioAudioNode = XAudioJSWebAudioContextHandle.createJavaScriptNode(XAudioJSSamplesPerCallback, 0, XAudioJSChannelsAllocated); //Create the js event node.
    }
    XAudioJSWebAudioAudioNode.onaudioprocess = XAudioJSWebAudioEvent; //Connect the audio processing event to a handling function so we can manipulate output
    XAudioJSWebAudioAudioNode.connect(XAudioJSWebAudioContextHandle.destination); //Send and chain the output of the audio manipulation to the system audio output.
    this.resetCallbackAPIAudioBuffer(XAudioJSWebAudioContextHandle.sampleRate);
    this.audioType = 1;
    /*
     Firefox has a bug in its web audio implementation...
     The node may randomly stop playing on Mac OS X for no
     good reason. Keep a watchdog timer to restart the failed
     node if it glitches. Google Chrome never had this issue.
     */
    XAudioJSWebAudioWatchDogLast = (new Date()).getTime();
    if (navigator.userAgent.indexOf('Gecko/') > -1) {
      if (XAudioJSWebAudioWatchDogTimer) {
        clearInterval(XAudioJSWebAudioWatchDogTimer);
      }
      XAudioJSWebAudioWatchDogTimer = setInterval(() => {
        var timeDiff = (new Date()).getTime() - XAudioJSWebAudioWatchDogLast;
        if (timeDiff > 500) {
          this.initializeWebAudio();
        }
      }, 500);
    }
  }

  MOZWriteAudioNoCallback(buffer) {
    //Resample before passing to the moz audio api:
    var bufferLength = buffer.length;
    for (var bufferIndex = 0; bufferIndex < bufferLength;) {
      var sliceLength = Math.min(bufferLength - bufferIndex, XAudioJSMaxBufferSize);
      for (var sliceIndex = 0; sliceIndex < sliceLength; ++sliceIndex) {
        XAudioJSAudioContextSampleBuffer[sliceIndex] = buffer[bufferIndex++];
      }
      var resampleLength = XAudioJSResampleControl.resampler(XAudioJSGetArraySlice(XAudioJSAudioContextSampleBuffer, sliceIndex));
      if (resampleLength > 0) {
        var resampledResult = XAudioJSResampleControl.outputBuffer;
        var resampledBuffer = XAudioJSGetArraySlice(resampledResult, resampleLength);
        this.samplesAlreadyWritten += this.audioHandleMoz.mozWriteAudio(resampledBuffer);
      }
    }
  }

  callbackBasedWriteAudioNoCallback(buffer) {
    //Callback-centered audio APIs:
    var length = buffer.length;
    for (var bufferCounter = 0; bufferCounter < length && XAudioJSAudioBufferSize < XAudioJSMaxBufferSize;) {
      XAudioJSAudioContextSampleBuffer[XAudioJSAudioBufferSize++] = buffer[bufferCounter++];
    }
  }

  /*Pass your samples into here!
    Pack your samples as a one-dimenional array
    With the channel samples packed uniformly.
    examples:
        mono - [left, left, left, left]
        stereo - [left, right, left, right, left, right, left, right]
  */
  writeAudio(buffer) {
    switch (this.audioType) {
      case 0:
        this.MOZWriteAudioNoCallback(buffer);
        this.MOZExecuteCallback();
        break;
      case 1:
      case 2:
        this.callbackBasedWriteAudioNoCallback(buffer);
        this.callbackBasedExecuteCallback();
        break;
      default:
        this.failureCallback();
    }
  }

  /*Pass your samples into here if you don't want automatic callback calling:
    Pack your samples as a one-dimenional array
    With the channel samples packed uniformly.
    examples:
        mono - [left, left, left, left]
        stereo - [left, right, left, right, left, right, left, right]
    Useful in preventing infinite recursion issues with calling writeAudio inside your callback.
  */
  writeAudioNoCallback(buffer) {
    switch (this.audioType) {
      case 0:
        this.MOZWriteAudioNoCallback(buffer);
        break;
      case 1:
      case 2:
        this.callbackBasedWriteAudioNoCallback(buffer);
        break;
      default:
        this.failureCallback();
    }
  }

  //Developer can use this to see how many samples to write (example: minimum buffer allotment minus remaining samples left returned from this function to make sure maximum buffering is done...)
  //If null is returned, then that means metric could not be done.
  remainingBuffer() {
    switch (this.audioType) {
      case 0:
        return Math.floor((this.samplesAlreadyWritten - this.audioHandleMoz.mozCurrentSampleOffset()) * XAudioJSResampleControl.ratioWeight / XAudioJSChannelsAllocated) * XAudioJSChannelsAllocated;
      case 1:
      case 2:
        return (Math.floor((XAudioJSResampledSamplesLeft() * XAudioJSResampleControl.ratioWeight) / XAudioJSChannelsAllocated) * XAudioJSChannelsAllocated) + XAudioJSAudioBufferSize;
      default:
        this.failureCallback();
        return null;
    }
  }

  MOZExecuteCallback() {
    //mozAudio:
    var samplesRequested = XAudioJSMinBufferSize - this.remainingBuffer();
    if (samplesRequested > 0) {
      this.MOZWriteAudioNoCallback(this.underRunCallback(samplesRequested));
    }
  }

  callbackBasedExecuteCallback() {
    //WebKit /Flash Audio:
    var samplesRequested = XAudioJSMinBufferSize - this.remainingBuffer();
    if (samplesRequested > 0) {
      this.callbackBasedWriteAudioNoCallback(this.underRunCallback(samplesRequested));
    }
  }

  //If you just want your callback called for any possible refill (Execution of callback is still conditional):
  executeCallback() {
    switch (this.audioType) {
      case 0:
        this.MOZExecuteCallback();
        break;
      case 1:
      case 2:
        this.callbackBasedExecuteCallback();
        break;
      default:
        this.failureCallback();
    }
  }

  //Set up the resampling:
  resetCallbackAPIAudioBuffer(APISampleRate) {
    XAudioJSAudioBufferSize = XAudioJSResampleBufferEnd = XAudioJSResampleBufferStart = 0;
    this.initializeResampler(APISampleRate);
    XAudioJSResampledBuffer = this.getFloat32(XAudioJSResampleBufferSize);
  }

  initializeResampler(sampleRate) {
    XAudioJSAudioContextSampleBuffer = this.getFloat32(XAudioJSMaxBufferSize);
    XAudioJSResampleBufferSize = Math.max(XAudioJSMaxBufferSize * Math.ceil(sampleRate / this.XAudioJSSampleRate) + XAudioJSChannelsAllocated, XAudioJSSamplesPerCallback * XAudioJSChannelsAllocated);
    XAudioJSResampleControl = new Resampler(this.XAudioJSSampleRate, sampleRate, XAudioJSChannelsAllocated, XAudioJSResampleBufferSize, true);
  }

  getFloat32(size) {
    try {
      return new Float32Array(size);
    } catch (error) {
      return [];
    }
  }
}

function XAudioJSWebAudioEvent(event) { //Web Audio API callback...
  if (XAudioJSWebAudioWatchDogTimer) {
    XAudioJSWebAudioWatchDogLast = (new Date()).getTime();
  }
  //Find all output channels:
  for (var bufferCount = 0, buffers = []; bufferCount < XAudioJSChannelsAllocated; ++bufferCount) {
    buffers[bufferCount] = event.outputBuffer.getChannelData(bufferCount);
  }
  //Make sure we have resampled samples ready:
  XAudioJSResampleRefill();
  //Copy samples from XAudioJS to the Web Audio API:
  for (var index = 0; index < XAudioJSSamplesPerCallback && XAudioJSResampleBufferStart != XAudioJSResampleBufferEnd; ++index) {
    for (bufferCount = 0; bufferCount < XAudioJSChannelsAllocated; ++bufferCount) {
      buffers[bufferCount][index] = XAudioJSResampledBuffer[XAudioJSResampleBufferStart++] * XAudioJSVolume;
    }
    if (XAudioJSResampleBufferStart == XAudioJSResampleBufferSize) {
      XAudioJSResampleBufferStart = 0;
    }
  }
  //Pad with silence if we're underrunning:
  while (index < XAudioJSSamplesPerCallback) {
    for (bufferCount = 0; bufferCount < XAudioJSChannelsAllocated; ++bufferCount) {
      buffers[bufferCount][index] = 0;
    }
    ++index;
  }
}

//MediaStream API buffer push
function XAudioJSMediaStreamPushAudio(event) {
  var index = 0;
  var audioLengthRequested = event.data;
  var samplesPerCallbackAll = XAudioJSSamplesPerCallback * XAudioJSChannelsAllocated;
  var XAudioJSMediaStreamLengthAlias = audioLengthRequested % XAudioJSSamplesPerCallback;
  audioLengthRequested = audioLengthRequested - (XAudioJSMediaStreamLengthAliasCounter - (XAudioJSMediaStreamLengthAliasCounter % XAudioJSSamplesPerCallback)) - XAudioJSMediaStreamLengthAlias + XAudioJSSamplesPerCallback;
  XAudioJSMediaStreamLengthAliasCounter -= XAudioJSMediaStreamLengthAliasCounter - (XAudioJSMediaStreamLengthAliasCounter % XAudioJSSamplesPerCallback);
  XAudioJSMediaStreamLengthAliasCounter += XAudioJSSamplesPerCallback - XAudioJSMediaStreamLengthAlias;
  if (XAudioJSMediaStreamBuffer.length != samplesPerCallbackAll) {
    XAudioJSMediaStreamBuffer = new Float32Array(samplesPerCallbackAll);
  }
  XAudioJSResampleRefill();
  while (index < audioLengthRequested) {
    var index2 = 0;
    while (index2 < samplesPerCallbackAll && XAudioJSResampleBufferStart != XAudioJSResampleBufferEnd) {
      XAudioJSMediaStreamBuffer[index2++] = XAudioJSResampledBuffer[XAudioJSResampleBufferStart++];
      if (XAudioJSResampleBufferStart == XAudioJSResampleBufferSize) {
        XAudioJSResampleBufferStart = 0;
      }
    }
    XAudioJSMediaStreamWorker.postMessage([0, XAudioJSMediaStreamBuffer]);
    index += XAudioJSSamplesPerCallback;
  }
}

function XAudioJSResampleRefill() {
  if (XAudioJSAudioBufferSize > 0) {
    //Resample a chunk of audio:
    var resampleLength = XAudioJSResampleControl.resampler(XAudioJSGetBufferSamples());
    var resampledResult = XAudioJSResampleControl.outputBuffer;
    for (var index2 = 0; index2 < resampleLength;) {
      XAudioJSResampledBuffer[XAudioJSResampleBufferEnd++] = resampledResult[index2++];
      if (XAudioJSResampleBufferEnd == XAudioJSResampleBufferSize) {
        XAudioJSResampleBufferEnd = 0;
      }
      if (XAudioJSResampleBufferStart == XAudioJSResampleBufferEnd) {
        XAudioJSResampleBufferStart += XAudioJSChannelsAllocated;
        if (XAudioJSResampleBufferStart == XAudioJSResampleBufferSize) {
          XAudioJSResampleBufferStart = 0;
        }
      }
    }
    XAudioJSAudioBufferSize = 0;
  }
}

function XAudioJSResampledSamplesLeft() {
  return ((XAudioJSResampleBufferStart <= XAudioJSResampleBufferEnd) ? 0 : XAudioJSResampleBufferSize) + XAudioJSResampleBufferEnd - XAudioJSResampleBufferStart;
}

function XAudioJSGetBufferSamples() {
  return XAudioJSGetArraySlice(XAudioJSAudioContextSampleBuffer, XAudioJSAudioBufferSize);
}

function XAudioJSGetArraySlice(buffer, lengthOf) {
  //Typed array and normal array buffer section referencing:
  try {
    return buffer.subarray(0, lengthOf);
  } catch (error) {
    try {
      //Regular array pass:
      buffer.length = lengthOf;
      return buffer;
    } catch (error) {
      //Nightly Firefox 4 used to have the subarray function named as slice:
      return buffer.slice(0, lengthOf);
    }
  }
}

export default XAudioServer
