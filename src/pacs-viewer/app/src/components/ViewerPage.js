import React, { useState, useEffect } from 'react';
import DicomViewer from './DicomViewer';

const ViewerPage = ({ study, initialInstance, onBack }) => {
  const [instances, setInstances] = useState([]);
  const [selected, setSelected] = useState(initialInstance);
  const studyUID = study["0020000D"].Value[0];

  useEffect(() => {
    fetch(`/dcm4chee-arc/aets/DCM4CHEE/rs/studies/${studyUID}/instances`)
      .then(r => r.json()).then(setInstances).catch(() => {});
  }, [studyUID]);

  const getTag = (obj, tag) => obj?.[tag]?.Value?.[0] || "-";

  return (
    <div className="viewer-full-screen">
      {/* SOL NAVİGASYON BARI */}
      <aside className="viewer-sidebar">
        <div className="sidebar-top">
          <button className="back-btn" onClick={onBack}>← LİSTEYE DÖN</button>
          <div className="patient-mini-card">
            <h4>{study["00100010"]?.Value?.[0]?.Alphabetic || "Anonymous"}</h4>
            <p>ID: {getTag(study, "00100020")}</p>
          </div>
        </div>
        
        <div className="thumbnail-container">
          {instances.map((ins, i) => (
            <div 
              key={i} 
              className={`thumb-box ${selected === ins ? 'active' : ''}`}
              onClick={() => setSelected(ins)}
            >
              <div className="thumb-icon">DICOM</div>
              <div className="thumb-meta">
                <span>Seri: {getTag(ins, "00200011")}</span>
                <span>Ins: {getTag(ins, "00200013")}</span>
              </div>
            </div>
          ))}
        </div>
      </aside>

      {/* ANA GÖRÜNTÜ ALANI */}
      <main className="viewer-viewport">
        <DicomViewer instance={selected} />
      </main>
    </div>
  );
};

export default ViewerPage;