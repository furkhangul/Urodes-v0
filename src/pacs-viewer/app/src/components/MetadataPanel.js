import React, { useState } from "react";
import { data as dcmData } from "dcmjs";

const DICOM_TAG_DICT = {
  "00100010": "PatientName",
  "00100020": "PatientID",
  "00100040": "PatientSex",
  "0020000D": "StudyInstanceUID",
  "0020000E": "SeriesInstanceUID",
  "00080018": "SOPInstanceUID",
  "00080060": "Modality",
  "00080020": "StudyDate",
  "00080030": "StudyTime",
  "00180015": "BodyPartExamined",
  "00201209": "NumberOfInstances"
};

const MetadataPanel = ({ studyUID, seriesUID, sopUID }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [metadata, setMetadata] = useState([]);

  const fetchMetadata = async () => {
    try {
      const response = await fetch(
        `/dcm4chee-arc/aets/DCM4CHEE/rs/studies/${studyUID}/series/${seriesUID}/instances/${sopUID}/metadata`
      );

      const data = await response.json();

      // DCM4CHEE metadata array döner
      const dicom = data[0];

      const formatted = Object.entries(dicom).map(([tag, value]) => {
        const tagWithComma = `(${tag.slice(0,4)},${tag.slice(4)})`;
//        const keyword = DICOM_TAG_DICT[tag.toUpperCase().trim()] || "Unknown";
//        const keyword =
//          dcmData.DicomMetaDictionary.nameMap[tagWithComma]?.keyword || "Unknown";
        const dictEntry = dcmData.DicomMetaDictionary.dictionary[tag];
        const keyword = dictEntry ? dictEntry.name : "Unknown";
        console.log("Dictionary entry:", dcmData.DicomMetaDictionary.dictionary[tag]);


        return {
          tag: tagWithComma,
          name: keyword,
          vr: value.vr,
          value: value.Value ? value.Value.join(", ") : "-"
        };
      });

      setMetadata(formatted);
      setIsOpen(true);

    } catch (err) {
      console.error("Metadata alınamadı:", err);
    }
  };

  return (
    <>
      <button className="metadata-btn" onClick={fetchMetadata}>
        METADATA
      </button>

      {isOpen && (
        <div 
          className="metadata-overlay"
          onClick={() => setIsOpen(false)}
        >
          <div 
            className="metadata-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="metadata-header">
              <h3>DICOM Metadata</h3>
              <button 
                className="close-btn"
                onClick={() => setIsOpen(false)}
              >
                ✕
              </button>
            </div>

            <div className="metadata-content">
              <table className="metadata-table">
                <thead>
                  <tr>
                    <th>Tag</th>
                    <th>Name</th>
                    <th>VR</th>
                    <th>Value</th>
                  </tr>
                </thead>
                <tbody>
                  {metadata.map((item, index) => {
                    const group = item.tag.slice(1, 5);
                    let levelClass = "meta-default";

                    // Önce özel UID highlight
                    if (item.tag === "(0020,000D)") {
                      levelClass = "highlight-study-uid";
                    } 
                    else if (item.tag === "(0020,000E)") {
                      levelClass = "highlight-series-uid";
                    } 
                    else if (item.tag === "(0008,0018)") {
                      levelClass = "highlight-sop-uid";
                    }

                    // Sonra grup bazlı renklendirme
                    else if (group === "0010") {
                      levelClass = "meta-patient";
                    } 
                    else if (group === "0020") {
                      levelClass = "meta-study";
                    } 
                    else if (group === "0008") {
                      levelClass = "meta-instance";
                    }

                    return (
                      <tr key={index} className={levelClass}>
                        <td>{item.tag}</td>
                        <td>{item.name}</td>
                        <td>{item.vr}</td>
                        <td className="meta-value">{item.value}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default MetadataPanel;
