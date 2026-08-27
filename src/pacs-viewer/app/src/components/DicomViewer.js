import React, { useEffect, useRef } from 'react';
import * as cornerstone from 'cornerstone-core';
import * as cornerstoneWADOImageLoader from 'cornerstone-wado-image-loader';
import dicomParser from 'dicom-parser';

cornerstoneWADOImageLoader.external.cornerstone = cornerstone;
cornerstoneWADOImageLoader.external.dicomParser = dicomParser;

// Loader Yapılandırması
cornerstoneWADOImageLoader.configure({
  beforeSend: function(xhr) {
    // 406 hatasını önlemek için genel kabul başlığı
    xhr.setRequestHeader('Accept', 'application/dicom, */*');
  },
  useWebWorkers: true,
});

// Web Worker dosyalarını projenin public klasöründen çekmesini sağlar
const config = {
  maxWebWorkers: navigator.hardwareConcurrency || 8, // Ryzen 9700X'in tüm çekirdeklerini kullan!
  startWebWorkersOnDemand: true,
  // webWorkerPath: '/cornerstoneWADOImageLoaderWebWorker.min.js',
  webWorkerPath: `${process.env.PUBLIC_URL || ''}/cornerstoneWADOImageLoaderWebWorker.min.js`,
  taskConfiguration: {
    decodeTask: {
      loadCodecsOnDemand: true,
    },
  },
};

cornerstoneWADOImageLoader.webWorkerManager.initialize(config);

const DicomViewer = ({ instance }) => {
  const viewerRef = useRef(null);

  useEffect(() => {
    if (!instance || !viewerRef.current) return;
    const element = viewerRef.current;
    cornerstone.enable(element);

    const studyUID = instance["0020000D"].Value[0];
    const seriesUID = instance["0020000E"].Value[0];
    const objectUID = instance["00080018"].Value[0];

    // WADO-URI Yöntemi (Daha stabil, 404'ü önlemek için)
    const imageId = `wadouri:${window.location.origin}/dcm4chee-arc/aets/DCM4CHEE/wado?requestType=WADO&studyUID=${studyUID}&seriesUID=${seriesUID}&objectUID=${objectUID}&contentType=application/dicom`;

    cornerstone.loadImage(imageId).then(image => {
      cornerstone.displayImage(element, image);
      cornerstone.fitToWindow(element);
      cornerstone.resize(element, true);
    }).catch(err => {
      // "samplesPerPixel" hatasını burada yakalıyoruz
      console.error("Cornerstone Load Error:", err);
    });

    return () => cornerstone.disable(element);
  }, [instance]);

  return (
    <div className="cornerstone-container" style={{ width: '100%', height: '100%' }}>
      <div ref={viewerRef} style={{ width: '100%', height: '100%', background: '#000' }} />
    </div>
  );
};

export default DicomViewer;
