import React, { useState, useEffect } from 'react';
import MetadataPanel from "./MetadataPanel";
import { fetchUserInfo, logout, resolveRoleLabel } from "../auth";


const PatientList = ({ onOpenViewer }) => {
  const [studies, setStudies] = useState([]);
  const [expandedPatients, setExpandedPatients] = useState({});
  const [expandedStudies, setExpandedStudies] = useState({});
  const [expandedSeries, setExpandedSeries] = useState({});
  const [pacs, setPacs] = useState({ series: {}, instances: {} });
  const [metadata, setMetadata] = useState([]);
  const [showMetadata, setShowMetadata] = useState(false);
  const [userInfo, setUserInfo] = useState(null);

  useEffect(() => {
    fetchUserInfo()
      .then(setUserInfo)
      .catch(() => setUserInfo(null));
  }, []);

  useEffect(() => {
    fetch('/dcm4chee-arc/aets/DCM4CHEE/rs/studies')
      .then(r => r.json()).then(data => {
        setStudies(data);
        if (data.length > 0) {
          const firstID = data[0]["00100020"].Value[0];
          setExpandedPatients({ [firstID]: true });
        }
      });
  }, []);

  const getTag = (obj, tag) => obj?.[tag]?.Value?.[0] || "-";

  const fetchSeries = (sUID) => {
    if (pacs.series[sUID]) return;
    fetch(`/dcm4chee-arc/aets/DCM4CHEE/rs/studies/${sUID}/series`)
      .then(r => r.json()).then(d => setPacs(v => ({...v, series: {...v.series, [sUID]: d}})));
  };

  const fetchInstances = (sUID, serUID) => {
    if (pacs.instances[serUID]) return;
    fetch(`/dcm4chee-arc/aets/DCM4CHEE/rs/studies/${sUID}/series/${serUID}/instances`)
      .then(r => r.json()).then(d => setPacs(v => ({...v, instances: {...v.instances, [serUID]: d}})));
  };

  const toggle = (state, setState, id) => setState(prev => ({...prev, [id]: !prev[id]}));
  const role = resolveRoleLabel(userInfo?.groups ?? []);

  return (
    <div className="list-container">
      <header className="main-header">
        <h2>Medical Archive Explorer</h2>
        <div className="header-actions">
          {userInfo && (
            <div className="user-panel">
              <span className={`role-badge ${role.className}`}>{role.label}</span>
            </div>
          )}
          <button type="button" className="logout-btn" onClick={logout}>
            Çıkış
          </button>
          <a href="/dcm4chee-arc/ui2/" target="_blank" rel="noreferrer" className="pacs-link">
            DCM4CHEE UI ↗
          </a>
        </div>
      </header>

      <div className="list-content" style={{marginTop: '20px'}}>
        {studies.map((std, i) => {
          const pID = getTag(std, "00100020");
          const sUID = getTag(std, "0020000D");

          return (
            <div key={pID + i}>
              <div className="row patient-row" onClick={() => toggle(expandedPatients, setExpandedPatients, pID)}>
                <div className="col">👤 {std["00100010"]?.Value?.[0]?.Alphabetic || "Anonymous"}</div>
                <div className="col">ID: {pID}</div>
                <div className="col">⚤ {getTag(std, "00100040")}</div>
                <div className="col">📚 {getTag(std, "00201200")} Studies</div>
              </div>

              {expandedPatients[pID] && (
                <div className="row study-row" onClick={() => { toggle(expandedStudies, setExpandedStudies, sUID); fetchSeries(sUID); }}>
                  <div className="col">📂 {getTag(std, "00081030")}</div>
                  <div className="col">📅 {getTag(std, "00080020")}</div>
                  <div className="col">Mod: {getTag(std, "00080061")}</div>
                  <div className="col">Series: {getTag(std, "00201206")}</div>
                </div>
              )}

              {expandedPatients[pID] && expandedStudies[sUID] && pacs.series[sUID]?.map((ser, j) => {
                const serUID = getTag(ser, "0020000E");
                return (
                  <div key={serUID + j}>
                    <div className="row series-row" onClick={() => { toggle(expandedSeries, setExpandedSeries, serUID); fetchInstances(sUID, serUID); }}>
                      <div className="col">🔹 {getTag(ser, "0008103E")}</div>
                      <div className="col">Mod: {getTag(ser, "00080060")}</div>
                      <div className="col">Inst: {getTag(ser, "00201209")}</div>
                      <div className="col">UID: ...{serUID.slice(-6)}</div>
                    </div>

                    {expandedSeries[serUID] && pacs.instances[serUID]?.map((ins, k) => (
                      <div key={k} className="row instance-row">
                        <div className="col">📄 {getTag(ins, "0008103E") || "Image"}</div>
                        <div className="col">Time: {getTag(ins, "00080023")}</div>
                        <div className="col">SOP: ...{getTag(ins, "00080018")?.slice(-6)}</div>
                        <div className="col"><button className="view-btn" onClick={() => onOpenViewer(std, ins)}>GÖRÜNTÜLE</button></div>
                        <div className="col"><MetadataPanel studyUID={sUID} seriesUID={serUID} sopUID={getTag(ins, "00080018")}/></div>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default PatientList;