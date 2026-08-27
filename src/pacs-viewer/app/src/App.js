import React, { useState } from 'react';
import PatientList from './components/PatientList';
import ViewerPage from './components/ViewerPage';
import './App.css';

const App = () => {
  const [view, setView] = useState('list'); 
  const [activeData, setActiveData] = useState(null);

  const handleOpenViewer = (study, instance) => {
    setActiveData({ study, instance });
    setView('viewer'); //
  };

  return (
    <div className="app-root">
      {/* Listeyi yok etmiyoruz, sadece gizliyoruz ki genişleme/sayfa durumu korunsun */}
      <div style={{ display: view === 'list' ? 'block' : 'none' }}>
        <PatientList onOpenViewer={handleOpenViewer} />
      </div>

      {view === 'viewer' && activeData && (
        <ViewerPage 
          study={activeData.study} 
          initialInstance={activeData.instance} 
          onBack={() => setView('list')} 
        />
      )}
    </div>
  );
};

export default App; //