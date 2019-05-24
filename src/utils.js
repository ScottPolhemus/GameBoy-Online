import settings from './settings'
import { cout } from './terminal'

export const fromTypedArray = (baseArray) => {
  try {
    if (!baseArray || !baseArray.length) {
      return [];
    }

    var arrayTemp = [];
    for (var index = 0; index < baseArray.length; ++index) {
      arrayTemp[index] = baseArray[index];
    }

    return arrayTemp;
  } catch (error) {
    cout("Conversion from a typed array failed: " + error.message, 1);

    return baseArray;
  }
}

export const toTypedArray = (baseArray, memtype) => {
  try {
    if (!baseArray || !baseArray.length) {
      return [];
    }

    var length = baseArray.length;

    switch (memtype) {
      case "uint8":
        var typedArrayTemp = new Uint8Array(length);
        break;
      case "int8":
        var typedArrayTemp = new Int8Array(length);
        break;
      case "int32":
        var typedArrayTemp = new Int32Array(length);
        break;
      case "float32":
        var typedArrayTemp = new Float32Array(length);
    }

    for (var index = 0; index < length; index++) {
      typedArrayTemp[index] = baseArray[index];
    }

    return typedArrayTemp;
  } catch (error) {
    cout("Could not convert an array to a typed array: " + error.message, 1);
    return baseArray;
  }
}

export const getTypedArray = (length, defaultValue, numberType) => {
  try {
    switch (numberType) {
      case "int8":
        var arrayHandle = new Int8Array(length);
        break;
      case "uint8":
        var arrayHandle = new Uint8Array(length);
        break;
      case "int32":
        var arrayHandle = new Int32Array(length);
        break;
      case "float32":
        var arrayHandle = new Float32Array(length);
    }

    if (defaultValue != 0) {
      var index = 0;

      while (index < length) {
        arrayHandle[index++] = defaultValue;
      }
    }
  } catch (error) {
    cout("Could not convert an array to a typed array: " + error.message, 1);

    var arrayHandle = [];
    var index = 0;
    while (index < length) {
      arrayHandle[index++] = defaultValue;
    }
  }

  return arrayHandle;
}

const toLittleEndianDWORD = (str) => {
  return toLittleEndianWORD(str) + toLittleEndianWORD(str >> 16);
}

const toLittleEndianWORD = (str) => {
  return toByte(str) + toByte(str >> 8);
}

const toByte = (str) => {
  return String.fromCharCode(str & 0xFF);
}

export const generateBlob = (keyName, encodedData) => {
  //Append the file format prefix:
  var saveString = "EMULATOR_DATA";
  var consoleID = "GameBoy";
  //Figure out the length:
  var totalLength = (saveString.length + 4 + (1 + consoleID.length)) + ((1 + keyName.length) + (4 + encodedData.length));
  //Append the total length in bytes:
  saveString += toLittleEndianDWORD(totalLength);
  //Append the console ID text's length:
  saveString += toByte(consoleID.length);
  //Append the console ID text:
  saveString += consoleID;
  //Append the blob ID:
  saveString += toByte(keyName.length);
  saveString += keyName;
  //Now append the save data:
  saveString += toLittleEndianDWORD(encodedData.length);
  saveString += encodedData;
  return saveString;
}

export const generateMultiBlob = (blobPairs) => {
  var consoleID = "GameBoy";
  //Figure out the initial length:
  var totalLength = 13 + 4 + 1 + consoleID.length;
  //Append the console ID text's length:
  var saveString = toByte(consoleID.length);
  //Append the console ID text:
  saveString += consoleID;
  var keyName = "";
  var encodedData = "";
  //Now append all the blobs:
  for (var index = 0; index < blobPairs.length; ++index) {
    keyName = blobPairs[index][0];
    encodedData = blobPairs[index][1];
    //Append the blob ID:
    saveString += toByte(keyName.length);
    saveString += keyName;
    //Now append the save data:
    saveString += toLittleEndianDWORD(encodedData.length);
    saveString += encodedData;
    //Update the total length:
    totalLength += 1 + keyName.length + 4 + encodedData.length;
  }
  //Now add the prefix:
  saveString = "EMULATOR_DATA" + toLittleEndianDWORD(totalLength) + saveString;
  return saveString;
}

export const decodeBlob = (blobData) => {
  /*Format is as follows:
    - 13 byte string "EMULATOR_DATA"
    - 4 byte total size (including these 4 bytes).
    - 1 byte Console type ID length
    - Console type ID text of 8 bit size
    blobs {
    - 1 byte blob ID length
    - blob ID text (Used to say what the data is (SRAM/freeze state/etc...))
    - 4 byte blob length
    - blob length of 32 bit size
    }
  */
  var length = blobData.length;
  var blobProperties = {};
  blobProperties.consoleID = null;
  var blobsCount = -1;
  blobProperties.blobs = [];
  if (length > 17) {
    if (blobData.substring(0, 13) == "EMULATOR_DATA") {
      var length = Math.min(((blobData.charCodeAt(16) & 0xFF) << 24) | ((blobData.charCodeAt(15) & 0xFF) << 16) | ((blobData.charCodeAt(14) & 0xFF) << 8) | (blobData.charCodeAt(13) & 0xFF), length);
      var consoleIDLength = blobData.charCodeAt(17) & 0xFF;
      if (length > 17 + consoleIDLength) {
        blobProperties.consoleID = blobData.substring(18, 18 + consoleIDLength);
        var blobIDLength = 0;
        var blobLength = 0;
        for (var index = 18 + consoleIDLength; index < length;) {
          blobIDLength = blobData.charCodeAt(index++) & 0xFF;
          if (index + blobIDLength < length) {
            blobProperties.blobs[++blobsCount] = {};
            blobProperties.blobs[blobsCount].blobID = blobData.substring(index, index + blobIDLength);
            index += blobIDLength;
            if (index + 4 < length) {
              blobLength = ((blobData.charCodeAt(index + 3) & 0xFF) << 24) | ((blobData.charCodeAt(index + 2) & 0xFF) << 16) | ((blobData.charCodeAt(index + 1) & 0xFF) << 8) | (blobData.charCodeAt(index) & 0xFF);
              index += 4;
              if (index + blobLength <= length) {
                blobProperties.blobs[blobsCount].blobContent = blobData.substring(index, index + blobLength);
                index += blobLength;
              } else {
                cout("Blob length check failed, blob determined to be incomplete.", 2);
                break;
              }
            } else {
              cout("Blob was incomplete, bailing out.", 2);
              break;
            }
          } else {
            cout("Blob was incomplete, bailing out.", 2);
            break;
          }
        }
      }
    }
  }
  return blobProperties;
}
