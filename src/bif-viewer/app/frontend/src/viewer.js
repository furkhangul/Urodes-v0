import OpenSeadragon from "openseadragon";
import { setupPrefetch } from "./prefetch.js";
import { initAuth, getUserInfo, hasRole, logout, getAccessToken, onTokenRefresh } from "./auth.js";

const app = document.querySelector("#app");
let currentSlides = [];
let currentOpenSlideSlides = [];
let currentInboxItems = [];
let currentDropzoneFiles = [];
let currentViewerUsers = [];
let selectedResource = null;
let viewer = null;
let currentMetadata = null;
let metricsTimer = null;
let metricsPaused = false;
let previousSelectionKey = null;
let heatmapActive = false;
let heatmapBusy = false;
let heatmapCache = null;
let heatmapAbort = null;
let autoLabelVisible = false;
// Isı haritası ile otomatik etiketlemenin paylaştığı tam slayt taraması
let slideScanSlideId = null;
let slideScanComplete = false;
let slideScanNextIndex = 0;
let autoLabelBusy = false;
let autoLabelAbort = null;
let autoLabelDetections = [];
// Taramayi hangi islem yurutuyor ("heatmap" | "autolabel" | null). Sekme
// yenilendiginde kaldigi yerden otomatik devam edebilmek icin saklanir.
let slideScanRunningKind = null;
let slideScanTotalCrops = 0;
// Sekme yeniden yuklendiginde geri yuklenen ama viewer acilana kadar
// uygulanamayan gorsel durum (etiketler / isi haritasi gorunur muydu).
let pendingScanRestore = null;
const viewportTileCache = createViewportTileCache(2000);

// DOM element references – populated in setupUI()
let uploadForm, fileInput, fileName;
let openSlideUploadForm, openSlideFileInput, openSlideFileName;
let statusCard, slidesList, slideCount;
let openSlideList, openSlideCount;
let uploadButton, refreshButton;
let openSlideUploadButton, openSlideRefreshButton;
let inboxList, inboxRefreshButton, storageSyncButton;
let dropzoneList, dropzoneRefreshButton;
let masterSlidesList, masterSlideCount;
let viewerEmpty, selectedSlideTitle, selectedSlideMeta;
let closeViewerButton, selectedEndpoint, selectedPyramid, selectedTileSize;
let debugZoom, debugTiles;
let viewerHud, viewerScaleWrap, viewerScaleLabel, viewerScaleLine;
let metricsStatus, metricProcessCpu, metricHeapUsed, metricFreeRam;

const token = getAccessToken();
const authHeaders = token ? { "Authorization": `Bearer ${token}` } : {};

function currentAuthHeaders() {
  const token = getAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function refreshViewerAuthHeaders(token = getAccessToken()) {
  if (!viewer) {
    return;
  }
  viewer.setAjaxHeaders(token ? { Authorization: `Bearer ${token}` } : {}, true);
}

function setupMasterUI(userInfo) {
  app.innerHTML = `
  <main class="resp-main" style="min-height: 100vh; margin: 0; background:
    radial-gradient(circle at top, rgba(47, 124, 246, 0.20), transparent 36%),
    linear-gradient(180deg, #0b1020 0%, #05070d 100%);
    color: #f5f7fa; font-family: 'SF Pro Display', 'Segoe UI', sans-serif; padding: 24px;">

    <nav style="max-width: 1120px; margin: 0 auto 20px; display: flex; justify-content: space-between; align-items: center; padding: 12px 20px; border-radius: 18px; background: rgba(9, 14, 28, 0.82); border: 1px solid rgba(125, 162, 255, 0.14);">
      <span style="font-weight: 700; font-size: 1rem; color: #9fbeff; letter-spacing: 0.04em;">BIF Viewer Master</span>
      <div style="display: flex; align-items: center; gap: 14px;">
        <span style="font-size: 0.88rem; color: rgba(245,247,250,0.72);">${userInfo.username}</span>
        <span style="padding: 4px 10px; border-radius: 999px; background: rgba(47,124,246,0.18); color: #9fbeff; font-size: 0.78rem; font-weight: 600;">master</span>
        <button id="logout-button" type="button" style="border: 1px solid rgba(245,247,250,0.18); border-radius: 999px; padding: 7px 14px; background: transparent; color: #f5f7fa; cursor: pointer; font-size: 0.85rem;">Çıkış</button>
      </div>
    </nav>

    <section style="max-width: 1120px; margin: 0 auto; display: grid; gap: 18px;">
      <article style="padding: 22px; border-radius: 24px; background: rgba(9, 14, 28, 0.92); border: 1px solid rgba(125, 162, 255, 0.18); box-shadow: 0 24px 80px rgba(0, 0, 0, 0.35);">
        <div style="display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 14px;">
          <div>
            <p style="margin: 0 0 6px; color: #7da2ff; letter-spacing: 0.2em; text-transform: uppercase; font-size: 12px;">Sunucu Dosya Havuzu</p>
            <h1 style="margin: 0; font-size: 1.45rem;">Dropzone'dan İçe Aktar</h1>
          </div>
          <button id="dropzone-refresh-button" type="button" style="border: 1px solid rgba(245, 247, 250, 0.18); border-radius: 999px; padding: 10px 14px; background: transparent; color: #f5f7fa; cursor: pointer;">
            Yenile
          </button>
        </div>
        <div id="status-card" style="margin-bottom: 16px; padding: 14px 16px; border-radius: 18px; background: rgba(255, 255, 255, 0.05); color: rgba(245, 247, 250, 0.78); min-height: 54px; word-break: break-word; line-height: 1.45;">
          BIF dosyaları HTTP upload ile gönderilmez. Dosyayı sunucuda <strong>src/bif-viewer/data/dropzone/</strong> klasörüne koy; sonra buradan içe aktar.
        </div>
        <div id="dropzone-list" style="display: grid; gap: 10px;">
          <div style="padding: 14px; border-radius: 16px; background: rgba(255, 255, 255, 0.04); color: rgba(245, 247, 250, 0.64);">
            Dropzone klasöründe içe aktarılacak dosya yok.
          </div>
        </div>
      </article>

      <article style="padding: 22px; border-radius: 24px; background: rgba(9, 14, 28, 0.92); border: 1px solid rgba(125, 162, 255, 0.18); box-shadow: 0 24px 80px rgba(0, 0, 0, 0.35);">
        <div style="display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 14px;">
          <div>
            <p style="margin: 0 0 6px; color: #7da2ff; letter-spacing: 0.2em; text-transform: uppercase; font-size: 12px;">Master Panel</p>
            <h1 style="margin: 0; font-size: 1.45rem;">Inbox Dosya Atamaları</h1>
          </div>
          <div style="display: flex; gap: 10px; flex-wrap: wrap; justify-content: flex-end;">
            <button id="inbox-refresh-button" type="button" style="border: 1px solid rgba(245, 247, 250, 0.18); border-radius: 999px; padding: 10px 14px; background: transparent; color: #f5f7fa; cursor: pointer;">
              Yenile
            </button>
            <button id="storage-sync-button" type="button" style="border: 1px solid rgba(125, 162, 255, 0.36); border-radius: 999px; padding: 10px 14px; background: rgba(47,124,246,0.14); color: #c8d8ff; cursor: pointer;">
              Verileri Güncelle
            </button>
          </div>
        </div>
        <div id="inbox-list" style="display: grid; gap: 10px;">
          <div style="padding: 14px; border-radius: 16px; background: rgba(255, 255, 255, 0.04); color: rgba(245, 247, 250, 0.64);">
            Bekleyen inbox dosyası yok.
          </div>
        </div>
      </article>

      <article style="padding: 22px; border-radius: 24px; background: rgba(9, 14, 28, 0.92); border: 1px solid rgba(125, 162, 255, 0.18); box-shadow: 0 24px 80px rgba(0, 0, 0, 0.35);">
        <div style="display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 14px;">
          <div>
            <p style="margin: 0 0 6px; color: #7da2ff; letter-spacing: 0.2em; text-transform: uppercase; font-size: 12px;">İşlenmiş Slaytlar</p>
            <h1 style="margin: 0; font-size: 1.45rem;">Atanmış Dosyalar</h1>
          </div>
          <span id="master-slide-count" style="padding: 6px 10px; border-radius: 999px; background: rgba(47, 124, 246, 0.14); color: #9fbeff; font-size: 0.9rem;">0</span>
        </div>
        <div id="master-slides-list" style="display: grid; gap: 10px;">
          <div style="padding: 14px; border-radius: 16px; background: rgba(255, 255, 255, 0.04); color: rgba(245, 247, 250, 0.64);">
            İşlenmiş slayt yok.
          </div>
        </div>
      </article>
    </section>
  </main>
`;

  statusCard = document.querySelector("#status-card");
  dropzoneList = document.querySelector("#dropzone-list");
  dropzoneRefreshButton = document.querySelector("#dropzone-refresh-button");
  inboxList = document.querySelector("#inbox-list");
  inboxRefreshButton = document.querySelector("#inbox-refresh-button");
  storageSyncButton = document.querySelector("#storage-sync-button");
  masterSlidesList = document.querySelector("#master-slides-list");
  masterSlideCount = document.querySelector("#master-slide-count");

  document.querySelector("#logout-button")?.addEventListener("click", () => {
    logout();
  });
  dropzoneRefreshButton?.addEventListener("click", async () => {
    await loadMasterData();
  });
  inboxRefreshButton?.addEventListener("click", async () => {
    await loadMasterData();
  });
  storageSyncButton?.addEventListener("click", async () => {
    await syncSlideStorage();
  });
}

function setupUI(isMaster, userInfo) {
  app.innerHTML = `
  <main class="resp-main" style="min-height: 100vh; margin: 0; background:
    radial-gradient(circle at top, rgba(47, 124, 246, 0.22), transparent 38%),
    linear-gradient(180deg, #0b1020 0%, #05070d 100%);
    color: #f5f7fa; font-family: 'SF Pro Display', 'Segoe UI', sans-serif; padding: 24px;">

    <nav class="resp-nav" style="max-width: 1480px; margin: 0 auto 20px; display: flex; justify-content: space-between; align-items: center; padding: 12px 20px; border-radius: 18px; background: rgba(9, 14, 28, 0.82); border: 1px solid rgba(125, 162, 255, 0.14);">
      <span style="font-weight: 700; font-size: 1rem; color: #9fbeff; letter-spacing: 0.04em;">BIF Viewer</span>
      <div style="display: flex; align-items: center; gap: 14px;">
        <span style="font-size: 0.88rem; color: rgba(245,247,250,0.72);">${userInfo.username}</span>
        <span style="padding: 4px 10px; border-radius: 999px; background: ${isMaster ? "rgba(47,124,246,0.18)" : "rgba(45,180,90,0.18)"}; color: ${isMaster ? "#9fbeff" : "#b5f3c6"}; font-size: 0.78rem; font-weight: 600;">${isMaster ? "master" : "viewer"}</span>
        <button id="logout-button" type="button" style="border: 1px solid rgba(245,247,250,0.18); border-radius: 999px; padding: 7px 14px; background: transparent; color: #f5f7fa; cursor: pointer; font-size: 0.85rem;">Çıkış</button>
      </div>
    </nav>

    <section style="max-width: 1480px; margin: 0 auto;">
      <section class="resp-cols" style="display: grid; grid-template-columns: 360px minmax(0, 1fr); gap: 20px; align-items: stretch;">
        <aside class="resp-side" style="display: grid; gap: 18px; align-content: start;">

          <article id="upload-section" style="padding: 22px; border-radius: 24px; background: rgba(9, 14, 28, 0.92); border: 1px solid rgba(125, 162, 255, 0.18); box-shadow: 0 24px 80px rgba(0, 0, 0, 0.35);">
            <div style="display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 12px;">
              <h2 style="margin: 0; font-size: 1.15rem;">BIF Upload</h2>
              <span style="padding: 6px 10px; border-radius: 999px; background: rgba(47, 124, 246, 0.14); color: #9fbeff; font-size: 0.85rem;">/app/slides</span>
            </div>

            <form id="upload-form" style="display: grid; gap: 14px;">
              <label for="slide-file" style="display: grid; gap: 10px; padding: 18px; border-radius: 20px; border: 1px dashed rgba(125, 162, 255, 0.42); background: rgba(125, 162, 255, 0.08); cursor: pointer;">
                <span style="font-size: 1.02rem; font-weight: 700;">BIF dosyasını seç</span>
                <span style="color: rgba(245, 247, 250, 0.68); line-height: 1.45;">Bu alan mevcut backend pipeline'ını kullanır. Sağ panel seçtiğin slaytı gerçek tile istekleriyle açar.</span>
                <input id="slide-file" name="file" type="file" accept=".bif,application/octet-stream" style="display: none;" />
                <span id="file-name" style="padding: 12px 14px; border-radius: 14px; background: rgba(255, 255, 255, 0.06); color: rgba(245, 247, 250, 0.86);">Henüz dosya seçilmedi</span>
              </label>

              <div style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap;">
                <button id="upload-button" type="submit" style="border: 0; border-radius: 999px; padding: 13px 18px; background: linear-gradient(135deg, #6ca5ff, #2f7cf6); color: #04101f; font-weight: 700; cursor: pointer;">
                  Upload BIF
                </button>
                <button id="refresh-button" type="button" style="border: 1px solid rgba(245, 247, 250, 0.18); border-radius: 999px; padding: 13px 18px; background: transparent; color: #f5f7fa; cursor: pointer;">
                  Yenile
                </button>
              </div>
            </form>

            <div id="status-card" style="margin-top: 16px; padding: 14px 16px; border-radius: 18px; background: rgba(255, 255, 255, 0.05); color: rgba(245, 247, 250, 0.78); min-height: 76px; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; word-break: break-word; line-height: 1.45;">
              Backend hazır. BIF ya da OpenSlide deneme alanından dosya seçebilirsin.
            </div>
          </article>

          <article style="padding: 20px; border-radius: 24px; background: rgba(255, 255, 255, 0.04); border: 1px solid rgba(255, 255, 255, 0.08);">
            <div style="display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 14px;">
              <h2 style="margin: 0; font-size: 1.05rem;">BIF Listesi</h2>
              <span id="slide-count" style="padding: 6px 10px; border-radius: 999px; background: rgba(47, 124, 246, 0.14); color: #9fbeff; font-size: 0.9rem;">0</span>
            </div>
            <div id="slides-list" style="display: grid; gap: 10px;">
              <div style="padding: 14px; border-radius: 16px; background: rgba(255, 255, 255, 0.04); color: rgba(245, 247, 250, 0.64);">
                Henüz yüklenmiş dosya yok.
              </div>
            </div>
          </article>

          <article id="openslide-upload-section" style="padding: 22px; border-radius: 24px; background: rgba(16, 12, 27, 0.92); border: 1px solid rgba(255, 176, 90, 0.18); box-shadow: 0 24px 80px rgba(0, 0, 0, 0.22);">
            <div style="display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 12px;">
              <h2 style="margin: 0; font-size: 1.15rem;">OpenSlide Deneme</h2>
              <span style="padding: 6px 10px; border-radius: 999px; background: rgba(255, 176, 90, 0.14); color: #ffd29d; font-size: 0.85rem;">/app/slides</span>
            </div>

            <form id="openslide-upload-form" style="display: grid; gap: 14px;">
              <label for="openslide-file" style="display: grid; gap: 10px; padding: 18px; border-radius: 20px; border: 1px dashed rgba(255, 176, 90, 0.42); background: rgba(255, 176, 90, 0.08); cursor: pointer;">
                <span style="font-size: 1.02rem; font-weight: 700;">OpenSlide ile açılacak dosyayı seç</span>
                <span style="color: rgba(245, 247, 250, 0.68); line-height: 1.45;">Bu alan ana pipeline'dan bağımsızdır. Dosya yalnızca OpenSlide deney endpoint'lerine yüklenir ve uygulama yeniden başlarsa tekrar seçmen gerekir.</span>
                <input id="openslide-file" name="file" type="file" accept=".bif,.svs,.tif,.tiff,.ndpi,.scn,.mrxs,.svslide,.vms,.vmu,.dcm,.czi" style="display: none;" />
                <span id="openslide-file-name" style="padding: 12px 14px; border-radius: 14px; background: rgba(255, 255, 255, 0.06); color: rgba(245, 247, 250, 0.86);">Henüz dosya seçilmedi</span>
              </label>

              <div style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap;">
                <button id="openslide-upload-button" type="submit" style="border: 0; border-radius: 999px; padding: 13px 18px; background: linear-gradient(135deg, #ffd59f, #ffb05a); color: #241100; font-weight: 700; cursor: pointer;">
                  Upload OpenSlide
                </button>
                <button id="openslide-refresh-button" type="button" style="border: 1px solid rgba(245, 247, 250, 0.18); border-radius: 999px; padding: 13px 18px; background: transparent; color: #f5f7fa; cursor: pointer;">
                  Yenile
                </button>
              </div>
            </form>
          </article>

          <article style="padding: 20px; border-radius: 24px; background: rgba(255, 255, 255, 0.04); border: 1px solid rgba(255, 255, 255, 0.08); min-height: 260px;">
            <div style="display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 14px;">
              <h2 style="margin: 0; font-size: 1.05rem;">OpenSlide Listesi</h2>
              <span id="openslide-count" style="padding: 6px 10px; border-radius: 999px; background: rgba(255, 176, 90, 0.14); color: #ffd29d; font-size: 0.9rem;">0</span>
            </div>
            <div id="openslide-list" style="display: grid; gap: 10px;">
              <div style="padding: 14px; border-radius: 16px; background: rgba(255, 255, 255, 0.04); color: rgba(245, 247, 250, 0.64);">
                Henüz OpenSlide denemesi için yüklenmiş dosya yok.
              </div>
            </div>
          </article>

          ${isMaster ? `
          <article style="padding: 20px; border-radius: 24px; background: rgba(255, 255, 255, 0.04); border: 1px solid rgba(255, 255, 255, 0.08); min-height: 260px;">
            <div style="display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 14px;">
              <h2 style="margin: 0; font-size: 1.05rem;">Inbox Atama</h2>
              <button id="inbox-refresh-button" type="button" style="border: 1px solid rgba(245, 247, 250, 0.18); border-radius: 999px; padding: 9px 12px; background: transparent; color: #f5f7fa; cursor: pointer;">
                Yenile
              </button>
              <button id="storage-sync-button" type="button" style="border: 1px solid rgba(125, 162, 255, 0.36); border-radius: 999px; padding: 9px 12px; background: rgba(47,124,246,0.14); color: #c8d8ff; cursor: pointer;">
                Verileri Güncelle
              </button>
            </div>
            <div id="inbox-list" style="display: grid; gap: 10px;">
              <div style="padding: 14px; border-radius: 16px; background: rgba(255, 255, 255, 0.04); color: rgba(245, 247, 250, 0.64);">
                Bekleyen inbox dosyası yok.
              </div>
            </div>
          </article>
          ` : ""}
        </aside>

        <section class="resp-viewer" style="display: grid; gap: 18px; min-width: 0;">
          <article style="padding: 20px 22px; border-radius: 24px; background: rgba(255, 255, 255, 0.04); border: 1px solid rgba(255, 255, 255, 0.08);">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; flex-wrap: wrap;">
              <div>
                <p style="margin: 0 0 8px; color: #7da2ff; letter-spacing: 0.2em; text-transform: uppercase; font-size: 12px;">Viewer Session</p>
                <h2 id="selected-slide-title" style="margin: 0; font-size: 1.8rem;">Slayt seçilmedi</h2>
              </div>
              <div style="display: grid; gap: 10px; justify-items: end;">
                <button id="close-viewer-button" type="button" style="border: 1px solid rgba(245, 247, 250, 0.18); border-radius: 999px; padding: 10px 14px; background: transparent; color: #f5f7fa; cursor: pointer; opacity: 0.6;" disabled>
                  Viewer Kapat
                </button>
                <div id="selected-slide-meta" style="display: grid; gap: 6px; color: rgba(245, 247, 250, 0.7); text-align: right;"></div>
              </div>
            </div>
          </article>

          <article style="padding: 18px 20px; border-radius: 24px; background: rgba(255, 255, 255, 0.04); border: 1px solid rgba(255, 255, 255, 0.08);">
            <div style="display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 14px;">
              <div>
                <p style="margin: 0 0 6px; color: #7da2ff; letter-spacing: 0.2em; text-transform: uppercase; font-size: 12px;">Runtime Metrics</p>
                <h3 style="margin: 0; font-size: 1.05rem;">Anlık CPU / RAM</h3>
              </div>
              <span id="metrics-status" style="padding: 6px 10px; border-radius: 999px; background: rgba(47, 124, 246, 0.14); color: #9fbeff; font-size: 0.85rem;">baglaniyor</span>
            </div>
            <div class="resp-metrics" style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px;">
              <div style="padding: 12px; border-radius: 18px; background: rgba(255,255,255,0.04);">
                <div style="font-size: 0.8rem; color: rgba(245,247,250,0.56); margin-bottom: 6px;">Process CPU</div>
                <div id="metric-process-cpu" style="font-size: 1.15rem; font-weight: 700;">-</div>
              </div>
              <div style="padding: 12px; border-radius: 18px; background: rgba(255,255,255,0.04);">
                <div style="font-size: 0.8rem; color: rgba(245,247,250,0.56); margin-bottom: 6px;">Heap Used</div>
                <div id="metric-heap-used" style="font-size: 1.15rem; font-weight: 700;">-</div>
              </div>
              <div style="padding: 12px; border-radius: 18px; background: rgba(255,255,255,0.04);">
                <div style="font-size: 0.8rem; color: rgba(245,247,250,0.56); margin-bottom: 6px;">Free RAM</div>
                <div id="metric-free-ram" style="font-size: 1.15rem; font-weight: 700;">-</div>
              </div>
            </div>
          </article>

          <article class="resp-stage" style="display: grid; grid-template-rows: minmax(560px, 72vh) auto; gap: 16px; padding: 18px; border-radius: 28px; background: rgba(3, 5, 12, 0.88); border: 1px solid rgba(125, 162, 255, 0.12); box-shadow: inset 0 1px 0 rgba(255,255,255,0.03), 0 30px 100px rgba(0, 0, 0, 0.45);">
            <div id="viewer-stage" style="position: relative; overflow: hidden; border-radius: 24px; background:
              radial-gradient(circle at center, rgba(90, 132, 255, 0.12), transparent 38%),
              linear-gradient(180deg, #0a101f 0%, #03060d 100%);">
              <div id="viewer-canvas" style="width: 100%; height: 100%; min-height: 560px;"></div>
              <div id="viewer-empty" style="position: absolute; inset: 0; display: grid; place-items: center; text-align: center; color: rgba(245, 247, 250, 0.62); padding: 24px; background: transparent;">
                <div style="max-width: 420px;">
                  <div style="font-size: 1.25rem; font-weight: 700; margin-bottom: 10px;">Henüz görüntülenecek slayt yok</div>
                  <div>Soldaki BIF veya OpenSlide listesinden bir dosyaya tıkla. Upload sonrası yeni dosya otomatik seçilir ve burada viewer açılır.</div>
                </div>
              </div>
              <div id="crop-overlay" style="display: none; position: absolute; inset: 0; z-index: 18; cursor: crosshair; touch-action: none; user-select: none;">
                <canvas id="crop-canvas" style="position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none;"></canvas>
                <div id="crop-hint" class="crop-hint" style="display: none;"><span class="dot"></span>Bölgeyi çizmek için sürükle — bırakınca panel açılır</div>
              </div>
              <div id="crop-toolbar" style="display: none; position: absolute; top: 14px; left: 14px; z-index: 36; align-items: center; gap: 8px; padding: 8px; border-radius: 999px; background: rgba(9,14,28,0.72); backdrop-filter: blur(14px); border: 1px solid rgba(125,162,255,0.28); box-shadow: 0 14px 40px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.06);">
                <button id="heatmap-toggle-button" class="tb-btn tb-heat" type="button" data-state="idle" title="Isı haritasını göster">
                  <span class="tb-halo" aria-hidden="true"></span>
                  <span class="tb-sheen" aria-hidden="true"></span>
                  <svg class="tb-progress-ring" viewBox="0 0 38 38" width="38" height="38" aria-hidden="true">
                    <circle class="tb-progress-track" cx="19" cy="19" r="16"/>
                    <circle class="tb-progress-fill" cx="19" cy="19" r="16"/>
                  </svg>
                  <span class="tb-ico tb-ico--idle">
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M12 2.69l.78 1.07C16.6 8.4 20 11.5 20 15.5a8 8 0 1 1-16 0c0-4 3.4-7.1 7.22-11.74L12 2.69z"/>
                      <path d="M12 21a3.5 3.5 0 0 0 3.5-3.5c0-1.5-.8-2.6-1.9-3.8-.8-.9-1.6-1.9-1.6-2.7"/>
                    </svg>
                  </span>
                  <span class="tb-ico tb-ico--busy tb-spin">
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
                      <circle cx="12" cy="12" r="9" opacity="0.28"/>
                      <path d="M21 12a9 9 0 0 0-9-9"/>
                      <circle cx="12" cy="12" r="1.9" fill="currentColor" stroke="none"/>
                    </svg>
                  </span>
                  <span class="tb-ico tb-ico--paused">
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round">
                      <line x1="9" y1="5" x2="9" y2="19"/>
                      <line x1="15" y1="5" x2="15" y2="19"/>
                    </svg>
                  </span>
                  <span class="tb-ico tb-ico--hidden">
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M3 3l18 18"/>
                      <path d="M10.6 5.2A9.9 9.9 0 0 1 12 5c5 0 9 4.5 9 7 0 .9-.9 2.3-2.3 3.6"/>
                      <path d="M6.4 6.9C4.1 8.4 3 10.4 3 12c0 2.5 4 7 9 7 1.5 0 2.9-.4 4.1-1"/>
                      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>
                    </svg>
                  </span>
                  <span class="tb-ico tb-ico--done">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M12 2.69l.78 1.07C16.6 8.4 20 11.5 20 15.5a8 8 0 1 1-16 0c0-4 3.4-7.1 7.22-11.74L12 2.69z" fill="currentColor" fill-opacity="0.28"/>
                      <path d="M12 21a3.5 3.5 0 0 0 3.5-3.5c0-1.5-.8-2.6-1.9-3.8-.8-.9-1.6-1.9-1.6-2.7" fill="currentColor" fill-opacity="0.55"/>
                    </svg>
                  </span>
                  <span class="tb-label">Isı Haritası</span>
                </button>
                <button id="crop-toggle-button" class="tb-btn" type="button" title="Bölge Seç" disabled style="cursor:not-allowed; opacity:0.55;">
                  <span class="tb-icon">
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                      <rect x="3" y="3" width="18" height="18" rx="4" stroke-dasharray="4 3"/>
                      <circle cx="3" cy="3" r="1.7" fill="currentColor" stroke="none"/>
                      <circle cx="21" cy="3" r="1.7" fill="currentColor" stroke="none"/>
                      <circle cx="3" cy="21" r="1.7" fill="currentColor" stroke="none"/>
                      <circle cx="21" cy="21" r="1.7" fill="currentColor" stroke="none"/>
                    </svg>
                  </span>
                  <span class="tb-label" id="crop-toggle-label">Bölge Seç</span>
                </button>
                <button id="crop-annot-toggle-button" class="tb-btn tb-annot" type="button" style="display:none;" title="Kutuları Göster / Gizle">
                  <span class="tb-icon">
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <rect x="3" y="3" width="8" height="8" rx="1.5"/>
                      <rect x="13" y="3" width="8" height="8" rx="1.5"/>
                      <rect x="3" y="13" width="8" height="8" rx="1.5"/>
                      <rect x="13" y="13" width="8" height="8" rx="1.5"/>
                    </svg>
                  </span>
                  <span class="tb-label" id="crop-annot-label">Kutuları Gizle</span>
                </button>
                <button id="crop-clear-tool-button" class="tb-btn tb-danger" type="button" style="display:none;" title="Temizle">
                  <span class="tb-icon">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">
                      <line x1="4" y1="4" x2="20" y2="20"/>
                      <line x1="20" y1="4" x2="4" y2="20"/>
                    </svg>
                  </span>
                  <span class="tb-label">Temizle</span>
                </button>
              </div>
              <div id="auto-label-toolbar" style="display: none; position: absolute; top: 14px; right: 14px; z-index: 36; align-items: center; gap: 8px; padding: 8px; border-radius: 999px; background: rgba(9,14,28,0.72); backdrop-filter: blur(14px); border: 1px solid rgba(47,124,246,0.35); box-shadow: 0 14px 40px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.06);">
                <button id="auto-label-button" class="tb-btn tb-robot" type="button" data-state="idle" title="Tüm slaytı otomatik etiketle (640x640 karolarla tam çözünürlük tarama)">
                  <svg class="tb-progress-ring" viewBox="0 0 38 38" width="38" height="38" aria-hidden="true">
                    <circle class="tb-progress-track" cx="19" cy="19" r="16"/>
                    <circle class="tb-progress-fill" cx="19" cy="19" r="16"/>
                  </svg>
                  <span class="tb-halo" aria-hidden="true"></span>
                  <span class="tb-sheen" aria-hidden="true"></span>
                  <span class="tb-ico tb-ico--idle">
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
                      <rect x="5" y="8" width="14" height="10" rx="3"/>
                      <circle cx="9.5" cy="13" r="1.4" fill="currentColor" stroke="none"/>
                      <circle cx="14.5" cy="13" r="1.4" fill="currentColor" stroke="none"/>
                      <path d="M12 8V5"/>
                      <circle cx="12" cy="4" r="1.2" fill="currentColor" stroke="none"/>
                      <path d="M8 18.5v1.8M16 18.5v1.8"/>
                    </svg>
                  </span>
                  <span class="tb-ico tb-ico--busy">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
                      <rect x="5" y="8" width="14" height="10" rx="3"/>
                      <circle cx="9.5" cy="13" r="1.4" fill="currentColor" stroke="none"/>
                      <circle cx="14.5" cy="13" r="1.4" fill="currentColor" stroke="none"/>
                      <path d="M12 8V5"/>
                      <circle cx="12" cy="4" r="1.2" fill="currentColor" stroke="none"/>
                      <path class="tb-scanline" d="M6 13h12"/>
                    </svg>
                  </span>
                  <span class="tb-ico tb-ico--paused">
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round">
                      <line x1="9" y1="5" x2="9" y2="19"/>
                      <line x1="15" y1="5" x2="15" y2="19"/>
                    </svg>
                  </span>
                  <span class="tb-ico tb-ico--hidden">
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M3 3l18 18"/>
                      <path d="M10.6 5.2A9.9 9.9 0 0 1 12 5c5 0 9 4.5 9 7 0 .9-.9 2.3-2.3 3.6"/>
                      <path d="M6.4 6.9C4.1 8.4 3 10.4 3 12c0 2.5 4 7 9 7 1.5 0 2.9-.4 4.1-1"/>
                      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>
                    </svg>
                  </span>
                  <span class="tb-ico tb-ico--done">
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M4 12.5l5 5L20 6"/>
                    </svg>
                  </span>
                  <span class="tb-label" id="auto-label-label">Otomatik Etiketle</span>
                </button>
              </div>
              <div id="crop-annot-tip" style="display:none;"></div>
              <div id="heatmap-legend" style="display: none; position: absolute; top: 76px; left: 16px; z-index: 24; padding: 12px 14px; border-radius: 16px; background: rgba(9,14,28,0.72); backdrop-filter: blur(16px); border: 1px solid rgba(178,102,255,0.30); box-shadow: 0 16px 40px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.05); color: #f5f7fa; min-width: 172px;">
                <div style="font-size: 0.72rem; letter-spacing: 0.14em; text-transform: uppercase; color: #ffd9a0; font-weight: 800; margin-bottom: 9px;">Hücre Yoğunluğu</div>
                <div style="display: flex; align-items: center; gap: 8px;">
                  <span style="font-size: 0.68rem; color: rgba(245,247,250,0.55);">Az</span>
                  <div style="flex: 1; height: 10px; border-radius: 999px; background: linear-gradient(90deg, #0000be, #008cff, #00dcdc, #00d200, #ffeb00, #ff8c00, #ff0000); box-shadow: inset 0 0 6px rgba(0,0,0,0.3);"></div>
                  <span style="font-size: 0.68rem; color: rgba(245,247,250,0.55);">Çok</span>
                </div>
              </div>
              <div id="viewer-hud" style="position: absolute; right: 16px; bottom: 16px; z-index: 22; display: none; align-items: center; gap: 14px; padding: 10px 16px; border-radius: 16px; background: rgba(9,14,28,0.72); backdrop-filter: blur(16px); border: 1px solid rgba(125,162,255,0.18); box-shadow: 0 16px 40px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.05); color: rgba(245,247,250,0.92);">
                <div style="display: flex; align-items: baseline; gap: 6px;">
                  <span style="font-size: 0.72rem; color: rgba(245,247,250,0.5); text-transform: uppercase; letter-spacing: 0.08em;">zoom</span>
                  <span id="debug-zoom" style="font-size: 0.86rem; font-weight: 700; min-width: 44px; text-align: right;">-</span>
                </div>
                <div style="width: 1px; height: 18px; background: rgba(125,162,255,0.22);"></div>
                <div style="display: flex; align-items: baseline; gap: 6px;">
                  <span style="font-size: 0.72rem; color: rgba(245,247,250,0.5); text-transform: uppercase; letter-spacing: 0.08em;">tiles</span>
                  <span id="debug-tiles" style="font-size: 0.86rem; font-weight: 700; min-width: 26px; text-align: right;">0</span>
                </div>
                <div style="width: 1px; height: 18px; background: rgba(125,162,255,0.22);"></div>
                <div id="viewer-scale-wrap" style="display: none; align-items: center; gap: 8px;">
                  <span id="viewer-scale-label" style="font-size: 0.82rem; font-weight: 700; white-space: nowrap;">-</span>
                  <div id="viewer-scale-line" style="height: 8px; width: 72px; border-left: 2px solid rgba(245,247,250,0.92); border-right: 2px solid rgba(245,247,250,0.92); border-bottom: 2px solid rgba(245,247,250,0.92);"></div>
                </div>
              </div>
              <div id="crop-panel-slot" style="position: absolute; top: 72px; left: 16px; z-index: 32; max-height: calc(100% - 88px);"></div>
              <div id="crop-editor-slot" style="position: absolute; top: 72px; left: 16px; z-index: 40; max-height: calc(100% - 88px); display: none;"></div>
            </div>

            <div style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px;">
              <div style="padding: 14px; border-radius: 18px; background: rgba(255,255,255,0.04);">
                <div style="font-size: 0.82rem; color: rgba(245, 247, 250, 0.56); margin-bottom: 6px;">Aktif endpoint</div>
                <div id="selected-endpoint" style="word-break: break-all; color: rgba(245, 247, 250, 0.86);">Seçilmedi</div>
              </div>
              <div style="padding: 14px; border-radius: 18px; background: rgba(255,255,255,0.04);">
                <div style="font-size: 0.82rem; color: rgba(245, 247, 250, 0.56); margin-bottom: 6px;">Pyramid</div>
                <div id="selected-pyramid" style="color: rgba(245, 247, 250, 0.86);">Bekleniyor</div>
              </div>
              <div style="padding: 14px; border-radius: 18px; background: rgba(255,255,255,0.04);">
                <div style="font-size: 0.82rem; color: rgba(245, 247, 250, 0.56); margin-bottom: 6px;">Tile size</div>
                <div id="selected-tile-size" style="color: rgba(245, 247, 250, 0.86);">Bekleniyor</div>
              </div>
            </div>
          </article>
        </section>
      </section>
    </section>
  </main>
`;

  // Offline ingestion model: BIF files are not uploaded through the browser.
  // Operators copy files to the host inbox directory instead:
  //   src/bif-viewer/data/inbox/
  // which is mounted into the container as:
  //   /app/inbox
  // The backend watcher registers stable files as PENDING inbox items.
  const uploadSection = document.querySelector("#upload-section");
  if (uploadSection) {
    if (isMaster) {
      uploadSection.innerHTML = `
        <div style="display: grid; gap: 12px;">
          <div style="display: flex; justify-content: space-between; align-items: center; gap: 12px;">
            <div>
              <p style="margin: 0 0 6px; color: #7da2ff; letter-spacing: 0.2em; text-transform: uppercase; font-size: 12px;">Offline Veri Aktarımı</p>
              <h2 style="margin: 0; font-size: 1.15rem;">BIF Dosyaları Inbox Klasöründen Alınır</h2>
            </div>
            <span style="padding: 6px 10px; border-radius: 999px; background: rgba(47, 124, 246, 0.14); color: #9fbeff; font-size: 0.85rem;">/app/inbox</span>
          </div>
          <div style="padding: 14px 16px; border-radius: 18px; background: rgba(255, 255, 255, 0.05); color: rgba(245, 247, 250, 0.78); line-height: 1.5;">
            BIF dosyası HTTP/browser upload ile gönderilmez. Dosyayı sunucuda şu klasöre kopyala:
            <code style="display: block; margin-top: 8px; padding: 10px 12px; border-radius: 12px; background: rgba(0,0,0,0.28); color: #cfe0ff; word-break: break-all;">src/bif-viewer/data/inbox/</code>
            Container içindeki karşılığı:
            <code style="display: block; margin-top: 8px; padding: 10px 12px; border-radius: 12px; background: rgba(0,0,0,0.28); color: #cfe0ff; word-break: break-all;">/app/inbox</code>
            Kopyalama tamamlandıktan sonra watcher dosyayı <code>.processing</code> altına alır ve aşağıdaki Inbox Atama listesinde PENDING olarak gösterir.
          </div>
        </div>
      `;
    } else {
      uploadSection.remove();
    }
  }
  document.querySelector("#openslide-upload-section")?.remove();

  // Query DOM elements
  uploadForm = document.querySelector("#upload-form");
  fileInput = document.querySelector("#slide-file");
  fileName = document.querySelector("#file-name");
  openSlideUploadForm = document.querySelector("#openslide-upload-form");
  openSlideFileInput = document.querySelector("#openslide-file");
  openSlideFileName = document.querySelector("#openslide-file-name");
  statusCard = document.querySelector("#status-card");
  slidesList = document.querySelector("#slides-list");
  slideCount = document.querySelector("#slide-count");
  openSlideList = document.querySelector("#openslide-list");
  openSlideCount = document.querySelector("#openslide-count");
  uploadButton = document.querySelector("#upload-button");
  refreshButton = document.querySelector("#refresh-button");
  openSlideUploadButton = document.querySelector("#openslide-upload-button");
  openSlideRefreshButton = document.querySelector("#openslide-refresh-button");
  inboxList = document.querySelector("#inbox-list");
  inboxRefreshButton = document.querySelector("#inbox-refresh-button");
  storageSyncButton = document.querySelector("#storage-sync-button");
  viewerEmpty = document.querySelector("#viewer-empty");
  selectedSlideTitle = document.querySelector("#selected-slide-title");
  selectedSlideMeta = document.querySelector("#selected-slide-meta");
  closeViewerButton = document.querySelector("#close-viewer-button");
  selectedEndpoint = document.querySelector("#selected-endpoint");
  selectedPyramid = document.querySelector("#selected-pyramid");
  selectedTileSize = document.querySelector("#selected-tile-size");
  debugZoom = document.querySelector("#debug-zoom");
  debugTiles = document.querySelector("#debug-tiles");
  viewerHud = document.querySelector("#viewer-hud");
  viewerScaleWrap = document.querySelector("#viewer-scale-wrap");
  viewerScaleLabel = document.querySelector("#viewer-scale-label");
  viewerScaleLine = document.querySelector("#viewer-scale-line");

  // Crop / bölge seç
  cropToggleButton = document.querySelector("#crop-toggle-button");
  cropToggleLabel = document.querySelector("#crop-toggle-label");
  cropClearToolButton = document.querySelector("#crop-clear-tool-button");
  cropToolbar = document.querySelector("#crop-toolbar");
  heatmapToggleButton = document.querySelector("#heatmap-toggle-button");
  heatmapLegend = document.querySelector("#heatmap-legend");
  autoLabelToolbar = document.querySelector("#auto-label-toolbar");
  autoLabelButton = document.querySelector("#auto-label-button");
  cropOverlay = document.querySelector("#crop-overlay");
  cropCanvas = document.querySelector("#crop-canvas");
  cropCtx = cropCanvas?.getContext("2d");
  cropHint = document.querySelector("#crop-hint");
  cropPanelSlot = document.querySelector("#crop-panel-slot");
  metricsStatus = document.querySelector("#metrics-status");
  metricProcessCpu = document.querySelector("#metric-process-cpu");
  metricHeapUsed = document.querySelector("#metric-heap-used");
  metricFreeRam = document.querySelector("#metric-free-ram");

  // Logout
  document.querySelector("#logout-button")?.addEventListener("click", () => {
    logout();
  });

  // File input labels
  if (fileInput) {
    fileInput.addEventListener("change", () => {
      const [file] = fileInput.files;
      fileName.textContent = file ? `${file.name} • ${formatBytes(file.size)}` : "Henüz dosya seçilmedi";
    });
  }

  if (openSlideFileInput) {
    openSlideFileInput.addEventListener("change", () => {
      const [file] = openSlideFileInput.files;
      openSlideFileName.textContent = file ? `${file.name} • ${formatBytes(file.size)}` : "Henüz dosya seçilmedi";
    });
  }

  // BIF upload
  if (uploadForm) {
    uploadForm.addEventListener("submit", async (event) => {
      event.preventDefault();

      const [file] = fileInput.files;
      if (!file) {
        setStatus("Önce bir BIF dosyası seç.", true);
        return;
      }

      const formData = new FormData();
      formData.append("file", file);

      setUploading(true);
      setStatus(`BIF yükleniyor: ${file.name}`, false);

      try {
        const response = await fetch("/bif-viewer/api/slides/upload", {
          method: "POST",
          body: formData,
          headers: authHeaders,
        });

        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload.message || payload.error || "Upload failed");
        }

        setStatus(`BIF yüklendi: ${payload.fileName} (${formatBytes(payload.sizeBytes)})`, false);
        uploadForm.reset();
        fileName.textContent = "Henüz dosya seçilmedi";
        await loadSlides(payload.slideId, true);
      } catch (error) {
        setStatus(`BIF upload hatası: ${error.message}`, true);
      } finally {
        setUploading(false);
      }
    });
  }

  // OpenSlide upload
  if (openSlideUploadForm) {
    openSlideUploadForm.addEventListener("submit", async (event) => {
      event.preventDefault();

      const [file] = openSlideFileInput.files;
      if (!file) {
        setStatus("Önce OpenSlide için bir dosya seç.", true);
        return;
      }

      const formData = new FormData();
      formData.append("file", file);

      setOpenSlideUploading(true);
      setStatus(`OpenSlide dosyası yükleniyor: ${file.name}`, false);

      try {
        const response = await fetch("/bif-viewer/api/openslide/upload", {
          method: "POST",
          body: formData,
          headers: authHeaders,
        });

        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload.message || payload.error || "OpenSlide upload failed");
        }

        setStatus(`OpenSlide ile yüklendi: ${payload.fileName} (${payload.vendor})`, false);
        openSlideUploadForm.reset();
        openSlideFileName.textContent = "Henüz dosya seçilmedi";
        await loadOpenSlideSlides(payload.slideId, true);
      } catch (error) {
        setStatus(`OpenSlide upload hatası: ${error.message}`, true);
      } finally {
        setOpenSlideUploading(false);
      }
    });
  }

  // Refresh buttons
  refreshButton?.addEventListener("click", () => {
    loadSlides();
  });

  if (openSlideRefreshButton) {
    openSlideRefreshButton.addEventListener("click", () => {
      loadOpenSlideSlides();
    });
  }

  if (inboxRefreshButton) {
    inboxRefreshButton.addEventListener("click", async () => {
      await loadMasterData();
    });
  }

  if (storageSyncButton) {
    storageSyncButton.addEventListener("click", async () => {
      await syncSlideStorage();
    });
  }

  // Crop / bölge seç
  injectResponsiveStyles();
  injectCropStyles();
  bindCropOverlayEvents();
  cropToggleButton?.addEventListener("click", () => {
    toggleCropMode();
  });
  heatmapToggleButton?.addEventListener("click", () => {
    toggleHeatmap();
  });
  autoLabelButton?.addEventListener("click", () => {
    toggleAutoLabel();
  });
  document.querySelector("#crop-annot-toggle-button")?.addEventListener("click", () => {
    toggleCropAnnotations();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (cropEditorOpen) {
        closeCropEditor();
      } else {
        closeCropLightbox();
      }
    }
  });
  cropClearToolButton?.addEventListener("click", () => {
    clearCropSelection();
  });
  setCropUiEnabled(false);

  // Close viewer
  closeViewerButton?.addEventListener("click", async () => {
    const selectionToClose = selectedResource;
    if (!selectionToClose) {
      return;
    }

    selectedResource = null;
    renderSlides(currentSlides);
    renderOpenSlideSlides(currentOpenSlideSlides);
    await clearViewer();
    await purgeSelection(selectionKey(selectionToClose));
    setStatus(`${selectionToClose.slideId} kapatıldı ve kaynaklar temizlendi.`, false);
  });
}

async function loadSlides(nextSelectedSlideId = getSelectedId("bif"), shouldRenderViewer = true) {
  try {
    const response = await fetch("/bif-viewer/api/slides", { headers: authHeaders });
    if (!response.ok) {
      throw new Error("BIF listesi yüklenemedi");
    }

    currentSlides = await response.json();

    if (nextSelectedSlideId && currentSlides.some((slide) => slide.slideId === nextSelectedSlideId)) {
      if (selectedResource?.kind === "bif") {
        selectedResource = createSelection("bif", nextSelectedSlideId);
      }
    } else if (selectedResource?.kind === "bif" && !currentSlides.some((slide) => slide.slideId === selectedResource.slideId)) {
      selectedResource = fallbackSelection();
    }

    renderSlides(currentSlides);
    if (shouldRenderViewer) {
      await renderViewer();
    }
  } catch (error) {
    currentSlides = [];
    renderSlides([]);
    if (selectedResource?.kind === "bif") {
      selectedResource = fallbackSelection();
      await renderViewer();
    }
    setStatus(`BIF listeleme hatası: ${error.message}`, true);
  }
}

async function loadOpenSlideSlides(nextSelectedSlideId = getSelectedId("openslide"), shouldRenderViewer = true) {
  try {
    const response = await fetch("/bif-viewer/api/openslide", { headers: authHeaders });
    if (!response.ok) {
      throw new Error("OpenSlide listesi yüklenemedi");
    }

    currentOpenSlideSlides = await response.json();

    if (nextSelectedSlideId && currentOpenSlideSlides.some((slide) => slide.slideId === nextSelectedSlideId)) {
      if (selectedResource?.kind === "openslide") {
        selectedResource = createSelection("openslide", nextSelectedSlideId);
      }
    } else if (selectedResource?.kind === "openslide" && !currentOpenSlideSlides.some((slide) => slide.slideId === selectedResource.slideId)) {
      selectedResource = fallbackSelection();
    }

    renderOpenSlideSlides(currentOpenSlideSlides);
    if (shouldRenderViewer) {
      await renderViewer();
    }
  } catch (error) {
    currentOpenSlideSlides = [];
    renderOpenSlideSlides([]);
    if (selectedResource?.kind === "openslide") {
      selectedResource = fallbackSelection();
      await renderViewer();
    }
    setStatus(`OpenSlide listeleme hatası: ${error.message}`, true);
  }
}

async function loadMasterData() {
  if (!inboxList && !dropzoneList) {
    return;
  }

  const headers = currentAuthHeaders();
  try {
    const [usersResponse, inboxResponse, dropzoneResponse, slidesResponse] = await Promise.all([
      fetch("/bif-viewer/api/users/viewers", { headers }),
      fetch("/bif-viewer/api/inbox", { headers }),
      fetch("/bif-viewer/api/dropzone/files", { headers }),
      fetch("/bif-viewer/api/slides", { headers }),
    ]);
    if (!usersResponse.ok) throw new Error("Kullanıcı listesi yüklenemedi");
    if (!inboxResponse.ok) throw new Error("Inbox listesi yüklenemedi");
    if (!dropzoneResponse.ok) throw new Error("Dropzone dosya listesi yüklenemedi");
    if (!slidesResponse.ok) throw new Error("İşlenmiş slayt listesi yüklenemedi");

    currentViewerUsers = await usersResponse.json();
    currentInboxItems = await inboxResponse.json();
    currentDropzoneFiles = await dropzoneResponse.json();
    currentSlides = await slidesResponse.json();

    renderDropzoneFiles();
    renderInboxItems();
    renderMasterSlides();
  } catch (error) {
    const target = dropzoneList || inboxList || masterSlidesList;
    if (target) {
      target.innerHTML = `
        <div style="padding: 14px; border-radius: 16px; background: rgba(255, 87, 87, 0.08); color: #ffb4b4;">
          ${escapeHtml(error.message)}
        </div>
      `;
    }
    setStatus(`Master veri yükleme hatası: ${error.message}`, true);
  }
}

async function syncSlideStorage() {
  if (!storageSyncButton) {
    return;
  }

  const previousText = storageSyncButton.textContent;
  storageSyncButton.disabled = true;
  storageSyncButton.textContent = "Kontrol ediliyor...";
  storageSyncButton.style.opacity = "0.72";
  storageSyncButton.style.cursor = "progress";
  setStatus("Slides klasörü ile veritabanı kayıtları karşılaştırılıyor...", false);

  try {
    const response = await fetch("/bif-viewer/api/slides/sync-storage", {
      method: "POST",
      headers: currentAuthHeaders(),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.message || payload.error || "Veri güncelleme başarısız");
    }

    if (selectedResource && payload.removedSlideIds?.includes(selectedResource.slideId)) {
      selectedResource = null;
      await clearViewer();
    }

    if (slidesList && openSlideList) {
      await Promise.all([
        loadSlides(null, false),
        loadOpenSlideSlides(null, false),
        loadMasterData(),
      ]);
      renderSlides(currentSlides);
      renderOpenSlideSlides(currentOpenSlideSlides);
    } else {
      await loadMasterData();
    }
    setStatus(`Veriler güncellendi. Kontrol: ${payload.checked}, kalan: ${payload.kept}, silinen slide: ${payload.removed}, silinen inbox: ${payload.removedInboxItems ?? 0}.`, false);
  } catch (error) {
    setStatus(`Veri güncelleme hatası: ${error.message}`, true);
  } finally {
    storageSyncButton.disabled = false;
    storageSyncButton.textContent = previousText;
    storageSyncButton.style.opacity = "1";
    storageSyncButton.style.cursor = "pointer";
  }
}

function renderSlides(slides) {
  slideCount.textContent = String(slides.length);

  if (!slides.length) {
    slidesList.innerHTML = `
      <div style="padding: 14px; border-radius: 16px; background: rgba(255, 255, 255, 0.04); color: rgba(245, 247, 250, 0.64);">
        Henüz yüklenmiş dosya yok.
      </div>
    `;
    return;
  }

  slidesList.innerHTML = slides.map((slide) => renderSlideCard(slide, "bif")).join("");
  slidesList.querySelectorAll("[data-kind='bif']").forEach((button) => {
    button.addEventListener("click", async () => {
      selectedResource = createSelection("bif", button.dataset.slideId);
      renderSlides(currentSlides);
      renderOpenSlideSlides(currentOpenSlideSlides);
      await renderViewer();
      setStatus(`${button.dataset.slideId} BIF viewer içinde açıldı.`, false);
    });
  });
}

function renderOpenSlideSlides(slides) {
  openSlideCount.textContent = String(slides.length);

  if (!slides.length) {
    openSlideList.innerHTML = `
      <div style="padding: 14px; border-radius: 16px; background: rgba(255, 255, 255, 0.04); color: rgba(245, 247, 250, 0.64);">
        Henüz OpenSlide denemesi için yüklenmiş dosya yok.
      </div>
    `;
    return;
  }

  openSlideList.innerHTML = slides.map((slide) => renderSlideCard(slide, "openslide")).join("");
  openSlideList.querySelectorAll("[data-kind='openslide']").forEach((button) => {
    button.addEventListener("click", async () => {
      selectedResource = createSelection("openslide", button.dataset.slideId);
      renderSlides(currentSlides);
      renderOpenSlideSlides(currentOpenSlideSlides);
      await renderViewer();
      setStatus(`${button.dataset.slideId} OpenSlide viewer içinde açıldı.`, false);
    });
  });
}

function renderDropzoneFiles() {
  if (!dropzoneList) {
    return;
  }

  if (!currentDropzoneFiles.length) {
    dropzoneList.innerHTML = `
      <div style="padding: 14px; border-radius: 16px; background: rgba(255, 255, 255, 0.04); color: rgba(245, 247, 250, 0.64);">
        Dropzone klasöründe içe aktarılacak dosya yok.
      </div>
    `;
    return;
  }

  dropzoneList.innerHTML = currentDropzoneFiles.map((file) => `
    <div data-dropzone-name="${escapeAttr(file.fileName)}" style="display: grid; gap: 10px; padding: 14px; border-radius: 18px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.06);">
      <div style="display: flex; justify-content: space-between; gap: 10px;">
        <div style="font-weight: 700; word-break: break-word;">${escapeHtml(file.fileName)}</div>
        <span style="padding: 4px 8px; border-radius: 999px; background: rgba(125,162,255,0.28); color: #f5f7fa; font-size: 0.75rem;">DROPZONE</span>
      </div>
      <div style="font-size: 0.9rem; color: rgba(245,247,250,0.66);">boyut: ${formatBytes(file.sizeBytes)}${file.lastModified ? ` · tarih: ${escapeHtml(file.lastModified)}` : ""}</div>
      <div style="display: flex; gap: 8px; flex-wrap: wrap;">
        <button data-dropzone-import type="button" style="border: 0; border-radius: 12px; padding: 10px 12px; background: rgba(47,124,246,0.9); color: #04101f; font-weight: 700; cursor: pointer;">
          İçe Aktar
        </button>
        <button data-dropzone-delete type="button" style="border: 1px solid rgba(255,87,87,0.42); border-radius: 12px; padding: 10px 12px; background: rgba(255,87,87,0.10); color: #ffb4b4; font-weight: 700; cursor: pointer;">
          Sil
        </button>
      </div>
    </div>
  `).join("");

  dropzoneList.querySelectorAll("[data-dropzone-import]").forEach((button) => {
    button.addEventListener("click", async () => {
      const row = button.closest("[data-dropzone-name]");
      await importDropzoneFile(row.dataset.dropzoneName);
    });
  });
  dropzoneList.querySelectorAll("[data-dropzone-delete]").forEach((button) => {
    button.addEventListener("click", async () => {
      const row = button.closest("[data-dropzone-name]");
      await deleteDropzoneFile(row.dataset.dropzoneName);
    });
  });
}

async function importDropzoneFile(fileName) {
  setStatus(`${fileName} inbox'a aktarılıyor...`, false);
  try {
    const response = await fetch(`/bif-viewer/api/dropzone/files/${encodeURIComponent(fileName)}/import`, {
      method: "POST",
      headers: currentAuthHeaders(),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.message || payload.error || "Dropzone içe aktarma başarısız");
    }
    setStatus(`${payload.fileName || fileName} inbox'a aktarıldı. Watcher PENDING kayıt oluşturacak.`, false);
    await wait(800);
    await loadMasterData();
  } catch (error) {
    setStatus(`Dropzone içe aktarma hatası: ${error.message}`, true);
    await loadMasterData();
  }
}

async function deleteDropzoneFile(fileName) {
  if (!confirm(`${fileName} dropzone klasöründen silinsin mi?`)) {
    return;
  }
  setStatus(`${fileName} siliniyor...`, false);
  try {
    const response = await fetch(`/bif-viewer/api/dropzone/files/${encodeURIComponent(fileName)}`, {
      method: "DELETE",
      headers: currentAuthHeaders(),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.message || payload.error || "Dropzone silme başarısız");
    }
    setStatus(`${fileName} dropzone klasöründen silindi.`, false);
    await loadMasterData();
  } catch (error) {
    setStatus(`Dropzone silme hatası: ${error.message}`, true);
    await loadMasterData();
  }
}

function renderMasterSlides() {
  if (!masterSlidesList) {
    return;
  }

  if (masterSlideCount) {
    masterSlideCount.textContent = String(currentSlides.length);
  }

  if (!currentSlides.length) {
    masterSlidesList.innerHTML = `
      <div style="padding: 14px; border-radius: 16px; background: rgba(255, 255, 255, 0.04); color: rgba(245, 247, 250, 0.64);">
        İşlenmiş slayt yok.
      </div>
    `;
    return;
  }

  masterSlidesList.innerHTML = currentSlides.map((slide) => `
    <div data-master-slide-id="${escapeAttr(slide.slideId)}" style="display: grid; gap: 10px; padding: 14px; border-radius: 18px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.06);">
      <div style="display: flex; justify-content: space-between; gap: 10px;">
        <div style="font-weight: 700; word-break: break-word;">${escapeHtml(slide.fileName)}</div>
        <span style="padding: 4px 8px; border-radius: 999px; background: rgba(45,180,90,0.30); color: #f5f7fa; font-size: 0.75rem;">${escapeHtml(slide.status || "READY")}</span>
      </div>
      <div style="font-size: 0.9rem; color: rgba(245,247,250,0.66);">slideId: ${escapeHtml(slide.slideId)} · boyut: ${formatBytes(slide.sizeBytes)}</div>
      <div style="display: flex; gap: 8px; flex-wrap: wrap;">
        <button data-master-slide-delete type="button" style="border: 1px solid rgba(255,87,87,0.42); border-radius: 12px; padding: 10px 12px; background: rgba(255,87,87,0.10); color: #ffb4b4; font-weight: 700; cursor: pointer;">
          Slaytı Sil
        </button>
      </div>
    </div>
  `).join("");

  masterSlidesList.querySelectorAll("[data-master-slide-delete]").forEach((button) => {
    button.addEventListener("click", async () => {
      const row = button.closest("[data-master-slide-id]");
      await deleteSlide(row.dataset.masterSlideId);
    });
  });
}


function renderInboxItems() {
  if (!inboxList) {
    return;
  }

  if (!currentInboxItems.length) {
    inboxList.innerHTML = `
      <div style="padding: 14px; border-radius: 16px; background: rgba(255, 255, 255, 0.04); color: rgba(245, 247, 250, 0.64);">
        Bekleyen inbox dosyası yok.
      </div>
    `;
    return;
  }

  inboxList.innerHTML = currentInboxItems.map((item) => {
    const disabled = item.status === "PROCESSING" || item.status === "INGESTED";
    const deletable = item.status !== "PROCESSING";
    return `
      <div data-inbox-id="${escapeAttr(item.id)}" style="display: grid; gap: 10px; padding: 14px; border-radius: 18px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.06);">
        <div style="display: flex; justify-content: space-between; gap: 10px;">
          <div style="font-weight: 700; word-break: break-word;">${escapeHtml(item.originalName)}</div>
          <span style="padding: 4px 8px; border-radius: 999px; background: ${inboxStatusColor(item.status)}; color: #f5f7fa; font-size: 0.75rem;">${escapeHtml(item.status)}</span>
        </div>
        <div style="font-size: 0.9rem; color: rgba(245,247,250,0.66);">boyut: ${formatBytes(item.sizeBytes)}</div>
        ${item.errorMessage ? `<div style="font-size: 0.9rem; color: #ffb4b4; word-break: break-word;">${escapeHtml(item.errorMessage)}</div>` : ""}
        <div style="display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px;">
          <select data-inbox-user style="min-width: 0; border: 1px solid rgba(245,247,250,0.16); border-radius: 12px; padding: 10px; background: rgba(0,0,0,0.26); color: #f5f7fa;" ${disabled ? "disabled" : ""}>
            <option value="">Keycloak ID ile ata</option>
            ${currentViewerUsers.map((user) => `
              <option value="${escapeAttr(user.id)}" ${item.assignedUserId === user.id ? "selected" : ""}>${escapeHtml(user.username || user.keycloakId)}</option>
            `).join("")}
          </select>
          <button data-inbox-assign type="button" style="border: 0; border-radius: 12px; padding: 10px 12px; background: rgba(47,124,246,0.9); color: #04101f; font-weight: 700; cursor: pointer;" ${disabled ? "disabled" : ""}>
            Ata ve İşle
          </button>
        </div>
        <input data-inbox-keycloak-id value="" placeholder="Keycloak user id (sub)" style="width: 100%; border: 1px solid rgba(245,247,250,0.16); border-radius: 12px; padding: 10px; background: rgba(0,0,0,0.26); color: #f5f7fa;" ${disabled ? "disabled" : ""} />
        <div style="display: flex; justify-content: flex-end;">
          <button data-inbox-delete type="button" style="border: 1px solid rgba(255,87,87,0.42); border-radius: 12px; padding: 10px 12px; background: rgba(255,87,87,0.10); color: #ffb4b4; font-weight: 700; cursor: pointer;" ${deletable ? "" : "disabled"}>
            Inbox Kaydını Sil
          </button>
        </div>
      </div>
    `;
  }).join("");

  inboxList.querySelectorAll("[data-inbox-assign]").forEach((button) => {
    button.addEventListener("click", async () => {
      const row = button.closest("[data-inbox-id]");
      const select = row.querySelector("[data-inbox-user]");
      const keycloakInput = row.querySelector("[data-inbox-keycloak-id]");
      await assignInboxItem(row.dataset.inboxId, select.value, keycloakInput.value.trim());
    });
  });
  inboxList.querySelectorAll("[data-inbox-delete]").forEach((button) => {
    button.addEventListener("click", async () => {
      const row = button.closest("[data-inbox-id]");
      await deleteInboxItem(row.dataset.inboxId);
    });
  });
}

async function assignInboxItem(inboxItemId, userId, keycloakId) {
  if (!userId && !keycloakId) {
    setStatus("Atama için kullanıcı seç ya da Keycloak user id gir.", true);
    return;
  }

  setStatus("Inbox dosyası atanıyor ve işleniyor...", false);
  try {
    const response = await fetch(`/bif-viewer/api/inbox/${encodeURIComponent(inboxItemId)}/assign`, {      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...currentAuthHeaders(),
      },
      body: JSON.stringify(userId ? { userId } : { keycloakId }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.message || payload.error || "Inbox atama başarısız");
    }
    setStatus(`${payload.originalName} atandı ve işlendi.`, false);
    if (slidesList && openSlideList) {
      await Promise.all([
        loadMasterData(),
        loadSlides(null, false),
        loadOpenSlideSlides(null, false),
      ]);
      renderSlides(currentSlides);
      renderOpenSlideSlides(currentOpenSlideSlides);
      return;
    }
    await loadMasterData();
  } catch (error) {
    setStatus(`Inbox atama hatası: ${error.message}`, true);
    await loadMasterData();
  }
}

async function deleteInboxItem(inboxItemId) {
  const item = currentInboxItems.find((entry) => entry.id === inboxItemId);
  const label = item?.originalName || inboxItemId;
  if (!confirm(`${label} inbox kaydı ve varsa kaynak dosyası silinsin mi?`)) {
    return;
  }
  setStatus(`${label} siliniyor...`, false);
  try {
    const response = await fetch(`/bif-viewer/api/inbox/${encodeURIComponent(inboxItemId)}`, {
      method: "DELETE",
      headers: currentAuthHeaders(),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.message || payload.error || "Inbox silme başarısız");
    }
    setStatus(`${label} silindi.`, false);
    await loadMasterData();
  } catch (error) {
    setStatus(`Inbox silme hatası: ${error.message}`, true);
    await loadMasterData();
  }
}

async function deleteSlide(slideId) {
  const slide = currentSlides.find((entry) => entry.slideId === slideId);
  const label = slide?.fileName || slideId;
  if (!confirm(`${label} slaytı diskten ve veritabanından silinsin mi?`)) {
    return;
  }
  setStatus(`${label} siliniyor...`, false);
  try {
    const response = await fetch(`/bif-viewer/api/slides/${encodeURIComponent(slideId)}`, {
      method: "DELETE",
      headers: currentAuthHeaders(),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.message || payload.error || "Slayt silme başarısız");
    }
    setStatus(`${label} silindi.`, false);
    if (selectedResource?.slideId === slideId) {
      selectedResource = null;
      if (viewerEmpty) {
        await clearViewer();
      }
    }
    await loadMasterData();
  } catch (error) {
    setStatus(`Slayt silme hatası: ${error.message}`, true);
    await loadMasterData();
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("`", "&#96;");
}


function inboxStatusColor(status) {
  if (status === "INGESTED") return "rgba(45,180,90,0.42)";
  if (status === "FAILED") return "rgba(255,87,87,0.42)";
  if (status === "PROCESSING") return "rgba(245,188,66,0.42)";
  return "rgba(125,162,255,0.28)";
}

function renderSlideCard(slide, kind) {
  const isSelected = selectedResource?.kind === kind && selectedResource.slideId === slide.slideId;
  const accent = kind === "openslide"
    ? { background: "rgba(255, 176, 90, 0.14)", border: "rgba(255, 176, 90, 0.42)", label: "OpenSlide" }
    : { background: "rgba(47, 124, 246, 0.16)", border: "rgba(108, 165, 255, 0.42)", label: "BIF" };

  return `
    <button
      type="button"
      data-kind="${kind}"
      data-slide-id="${slide.slideId}"
      style="text-align: left; padding: 14px; border-radius: 18px; background: ${isSelected ? accent.background : "rgba(255, 255, 255, 0.05)"}; border: 1px solid ${isSelected ? accent.border : "rgba(255, 255, 255, 0.05)"}; color: #f5f7fa; cursor: pointer; transition: 120ms ease;">
      <div style="display: flex; justify-content: space-between; gap: 12px; margin-bottom: 6px;">
        <div style="font-weight: 700;">${slide.fileName}</div>
        <span style="padding: 4px 8px; border-radius: 999px; background: ${kind === "openslide" ? "rgba(255,176,90,0.16)" : "rgba(47,124,246,0.16)"}; color: ${kind === "openslide" ? "#ffd29d" : "#9fbeff"}; font-size: 0.75rem;">${accent.label}</span>
      </div>
      <div style="font-size: 0.92rem; color: rgba(245, 247, 250, 0.68);">slideId: ${slide.slideId}</div>
      <div style="font-size: 0.92rem; color: rgba(245, 247, 250, 0.68);">boyut: ${formatBytes(slide.sizeBytes)}</div>
      ${slide.vendor ? `<div style="font-size: 0.92rem; color: rgba(245, 247, 250, 0.68);">vendor: ${slide.vendor}</div>` : ""}
    </button>
  `;
}

function normalizePyramidMetadata(meta) {
  if (!meta?.levels?.length) return meta;
  const first = meta.levels[0];
  const last = meta.levels[meta.levels.length - 1];
  // BIF düzeni: levels[0] = en yüksek çözünürlük, width/height = en küçük seviye.
  // OpenSlide düzeni standarttır (levels[0] = en küçük). BIF'i standarta çevir:
  if (first.width > last.width && meta.width <= first.width && meta.width >= last.width) {
    meta.levels = [...meta.levels].reverse();
    const full = meta.levels[meta.levels.length - 1];
    meta.width = full.width;
    meta.height = full.height;
  }
  return meta;
}

async function renderViewer() {
  const entry = getSelectedEntry();
  if (!entry) {
    await clearViewer();
    return;
  }

  const currentSelectionKey = selectionKey(selectedResource);
  if (previousSelectionKey && previousSelectionKey !== currentSelectionKey) {
    destroyViewer();
    await purgeSelection(previousSelectionKey);
    await loadMetrics();
  }
  previousSelectionKey = currentSelectionKey;

  const { kind, slide } = entry;
  const metadataUrl = kind === "openslide"
    ? `/bif-viewer/api/openslide/${encodeURIComponent(slide.slideId)}/metadata`
    : `/bif-viewer/api/slides/${encodeURIComponent(slide.slideId)}/metadata`;
  const endpointPattern = kind === "openslide"
    ? `/bif-viewer/api/openslide/tiles/${slide.slideId}/{z}/{x}/{y}`
    : `/bif-viewer/api/tiles/${slide.slideId}/{z}/{x}/{y}`;

  try {
    const response = await fetch(metadataUrl);
    if (!response.ok) {
      throw new Error("Metadata could not be loaded");
    }

    currentMetadata = normalizePyramidMetadata(await response.json());
    selectedSlideTitle.textContent = slide.fileName;
    selectedSlideMeta.innerHTML = `
      <span>kaynak: ${kind === "openslide" ? "OpenSlide deneme" : "BIF pipeline"}</span>
      <span>slideId: ${slide.slideId}</span>
      <span>dosya boyutu: ${formatBytes(slide.sizeBytes)}</span>
      <span>boyut: ${currentMetadata.width} x ${currentMetadata.height}</span>
      ${currentMetadata.vendor ? `<span>vendor: ${currentMetadata.vendor}</span>` : ""}
    `;
    selectedEndpoint.textContent = endpointPattern;
    selectedPyramid.textContent = `${currentMetadata.levels.length} level`;
    selectedTileSize.textContent = `${currentMetadata.tileSize}px`;
    viewerEmpty.style.display = "none";
    setViewerClosable(true);
    persistSelection(selectedResource);

    if (kind !== "openslide") {
      // İlk açılışta görünen düşük çözünürlüklü tile'ların sunucu tarafında
      // (Bio-Formats reader havuzu) önceden ısıtılması için — sonucu beklemeden
      // arka planda tetiklenir, viewer'ın kendi tile isteklerini engellemez.
      fetch(`/bif-viewer/api/slides/${encodeURIComponent(slide.slideId)}/warmup?levels=2`, {
        method: "POST",
        headers: currentAuthHeaders(),
      }).catch(() => {});
    }

    openSlideViewer({
      sourceKey: currentSelectionKey,
      tileUrlBase: kind === "openslide"
        ? `/bif-viewer/api/openslide/tiles/${encodeURIComponent(slide.slideId)}`
        : `/bif-viewer/api/tiles/${encodeURIComponent(slide.slideId)}`,
      metadata: currentMetadata,
    });
  } catch (error) {
    await clearViewer();
    setStatus(`Viewer hatası: ${error.message}`, true);
  }
}

function destroyViewer() {
  if (!viewer) {
    return;
  }
  metricsPaused = false;
  try {
    if (viewer.world) {
      viewer.world.removeAll();
    }
    if (viewer.tileCache && typeof viewer.tileCache.clearTilesFor === "function" && viewer.world) {
      const tiledImage = viewer.world.getItemAt(0);
      if (tiledImage) {
        viewer.tileCache.clearTilesFor(tiledImage);
      }
    }
    if (viewer.imageLoader && typeof viewer.imageLoader.clear === "function") {
      viewer.imageLoader.clear();
    }
  } catch (error) {
    console.warn("Viewer teardown warning", error);
  }
  viewer.destroy();
  viewer = null;
}

async function clearViewer() {
  metricsPaused = false;
  selectedSlideTitle.textContent = "Slayt seçilmedi";
  selectedSlideMeta.innerHTML = "<span>Sol panelden BIF veya OpenSlide dosyası seç</span>";
  selectedEndpoint.textContent = "Seçilmedi";
  selectedPyramid.textContent = "Bekleniyor";
  selectedTileSize.textContent = "Bekleniyor";
  debugZoom.textContent = "-";
  debugTiles.textContent = "0";
  hideScaleBar();
  currentMetadata = null;
  previousSelectionKey = null;
  destroyViewer();
  viewerEmpty.style.display = "grid";
  if (viewerHud) viewerHud.style.display = "none";
  resetHeatmap();
  resetAutoLabel();
  clearScanState();
  viewportTileCache.resetForSlide(null);
  setCropUiEnabled(false);
  cropReset();
  setViewerClosable(false);
  persistSelection(null);
}

async function purgeSelection(selectionIdentifier) {
  viewportTileCache.resetForSlide(null);
  if (!selectionIdentifier) {
    return;
  }

  const [kind, slideId] = selectionIdentifier.split(":");
  if (!slideId) {
    return;
  }

  try {
    if (kind === "bif") {
      await fetch(`/bif-viewer/api/slides/${encodeURIComponent(slideId)}/cache`, {
        method: "DELETE",
        keepalive: true,
      });
      return;
    }

    if (kind === "openslide") {
      await fetch(`/bif-viewer/api/openslide/${encodeURIComponent(slideId)}`, {
        method: "DELETE",
        keepalive: true,
      });
    }
  } catch (error) {
    console.warn(`Slide cache temizleme başarısız: ${selectionIdentifier}`, error);
  }
}

function openSlideViewer({ sourceKey, tileUrlBase, metadata }) {
  destroyViewer();
  cropReset();
  resetHeatmap();
  resetAutoLabel();
  hideScaleBar();
  viewportTileCache.resetForSlide(sourceKey);

  let tileLoads = 0;
  let pendingTileLoads = 0;
  const maxLevel = metadata.levels.length - 1;
  let lastZoomPaintAt = 0;
  let zoomPaintScheduled = false;
  let tilePaintScheduled = false;
  let scaleBarPaintScheduled = false;
  let dragging = false;
  let motionMode = false;
  let tileLoadPaintIntervalMs = 120;
  let zoomPaintIntervalMs = 100;

  const scheduleScaleBarUpdate = () => {
    if (scaleBarPaintScheduled) {
      return;
    }
    scaleBarPaintScheduled = true;
    window.requestAnimationFrame(() => {
      scaleBarPaintScheduled = false;
      updateScaleBar(metadata);
    });
  };

  const tileSource = {
    width: metadata.width,
    height: metadata.height,
    tileSize: metadata.tileSize,
    tileOverlap: 0,
    minLevel: 0,
    maxLevel,
    getLevelScale(level) {
      const levelInfo = metadata.levels[level];
      return levelInfo.width / metadata.width;
    },
    getNumTiles(level) {
      const levelInfo = metadata.levels[level];
      return {
        x: levelInfo.tileColumns,
        y: levelInfo.tileRows,
      };
    },
    tileExists(level, x, y) {
      const levelInfo = metadata.levels[level];
      return x >= 0
        && y >= 0
        && x < levelInfo.tileColumns
        && y < levelInfo.tileRows;
    },
    getTileUrl(level, x, y) {
      return viewportTileCache.resolveUrl(sourceKey, tileUrlBase, level, x, y);
    },
    getTileAjaxHeaders() {
      return currentAuthHeaders();
    },
    ajaxHeaders: currentAuthHeaders(),
  };

  viewer = OpenSeadragon({
    id: "viewer-canvas",
    tileSources: tileSource,
    tileSize: metadata.tileSize,
    immediateRender: true,
    imageLoaderLimit: 12,
    maxImageCacheCount: 1200,
    timeout: 60000,
    drawer: ["canvas", "webgl", "html"],
    loadTilesWithAjax: true,
    ajaxHeaders: currentAuthHeaders(),
    animationTime: 0.2,
    blendTime: 0.05,
    alwaysBlend: false,
    placeholderFillStyle: "rgba(255,255,255,0.04)",
    minZoomImageRatio: 0.1,
    maxZoomPixelRatio: 4,
    visibilityRatio: 0.5,
    springStiffness: 10.0,
    zoomPerScroll: 1.2,
    showNavigationControl: false,
    showNavigator: true,
    navigatorPosition: "BOTTOM_LEFT",
  });
  refreshViewerAuthHeaders();

  // Ana görselde kutu üzerine gelince etiket göstermek için hover dinleyicileri
  if (viewer?.canvas) {
    viewer.canvas.addEventListener("mousemove", onCropAnnotHover);
    viewer.canvas.addEventListener("mouseleave", hideCropAnnotTip);
    viewer.canvas.addEventListener("dblclick", onCropAnnotDblClick);
    viewer.canvas.addEventListener("click", onCropCanvasClick);
  }
  viewer.gestureSettingsMouse.dblClickToZoom = false;

  // Crop overlay'in pan/zoom sırasında görselle eşleşmesi için
  viewer.addHandler("open", redrawCropOverlay);
  viewer.addHandler("animation", redrawCropOverlay);
  viewer.addHandler("resize", redrawCropOverlay);
  viewer.addHandler("canvas-drag-end", redrawCropOverlay);

  setupPrefetch(viewer, {
    slideId: sourceKey,
    maxLevel,
    isMotionMode() {
      return motionMode;
    },
    prefetchTile(level, x, y) {
      viewportTileCache.prefetch(sourceKey, tileUrlBase, level, x, y);
    },
    levelForViewport() {
      const tiledImage = viewer.world.getItemAt(0);
      if (!tiledImage) {
        return maxLevel;
      }

      const imageZoom = tiledImage.viewportToImageZoom(viewer.viewport.getZoom(true));
      const scaledLevel = Math.round(Math.log2(Math.max(1, imageZoom)));
      return Math.max(0, Math.min(maxLevel, scaledLevel));
    },
  });

  viewer.addHandler("open", () => {
    metricsPaused = false;
    debugZoom.textContent = "1.00x";
    debugTiles.textContent = "0";
    if (viewerHud) viewerHud.style.display = "flex";
    warmViewportCache(sourceKey, tileUrlBase, metadata, 2);
    warmBaselineLevels(sourceKey, tileUrlBase, metadata);
    scheduleScaleBarUpdate();
    setStatus(`${sourceKey} viewer içinde açıldı.`, false);
    loadMetrics();
    setCropUiEnabled(true);
    if (autoLabelToolbar) autoLabelToolbar.style.display = "flex";
    // Bu slayda ait kayitli tarama varsa (sayfa yenilense, tarayici kapatilip
    // acilsa bile) etiketleri/isi haritasini geri getir, gerekiyorsa surdur.
    restoreScanState(getSelectedEntry()?.slide?.slideId ?? null)
      .then(applyScanRestore)
      .catch((error) => console.warn("Tarama geri yüklenemedi", error));
  });

  viewer.addHandler("animation", () => {
    if (motionMode) {
      return;
    }

    const now = performance.now();
    const paintZoom = () => {
      zoomPaintScheduled = false;
      lastZoomPaintAt = performance.now();
      const zoom = viewer.viewport.getZoom(true);
      debugZoom.textContent = `${zoom.toFixed(2)}x`;
      scheduleScaleBarUpdate();
    };

    if (now - lastZoomPaintAt >= zoomPaintIntervalMs) {
      paintZoom();
      return;
    }

    if (!zoomPaintScheduled) {
      zoomPaintScheduled = true;
      window.requestAnimationFrame(paintZoom);
    }
  });

  viewer.addHandler("tile-loaded", () => {
    pendingTileLoads += 1;
    if (tilePaintScheduled) {
      return;
    }

    tilePaintScheduled = true;
    window.setTimeout(() => {
      tilePaintScheduled = false;
      tileLoads += pendingTileLoads;
      pendingTileLoads = 0;
      debugTiles.textContent = String(tileLoads);
    }, tileLoadPaintIntervalMs);
  });

  viewer.addHandler("canvas-drag", () => {
    if (!dragging) {
      dragging = true;
      metricsPaused = true;
      motionMode = true;
      tileLoadPaintIntervalMs = 220;
      zoomPaintIntervalMs = 180;
      viewer.viewport.centerSpringX.animationTime = 0.12;
      viewer.viewport.centerSpringY.animationTime = 0.12;
      viewer.viewport.zoomSpring.animationTime = 0.14;
      viewer.world.setAutoRefigureSizes(false);
      debugZoom.textContent = "motion";
    }
  });

  viewer.addHandler("canvas-drag-end", () => {
    dragging = false;
    metricsPaused = false;
    motionMode = false;
    tileLoadPaintIntervalMs = 120;
    zoomPaintIntervalMs = 100;
    viewer.viewport.centerSpringX.animationTime = 0.2;
    viewer.viewport.centerSpringY.animationTime = 0.2;
    viewer.viewport.zoomSpring.animationTime = 0.2;
    viewer.world.setAutoRefigureSizes(true);
    warmViewportCache(sourceKey, tileUrlBase, metadata, 2);
    scheduleScaleBarUpdate();
    loadMetrics();
  });

  viewer.addHandler("animation-finish", () => {
    if (!dragging) {
      warmViewportCache(sourceKey, tileUrlBase, metadata, 2);
    }
    scheduleScaleBarUpdate();
  });

  viewer.addHandler("resize", () => {
    scheduleScaleBarUpdate();
  });

  function warmBaselineLevels(activeSourceKey, activeTileUrlBase, activeMetadata) {
    const baselineLevels = [0, Math.min(1, maxLevel)];
    for (const level of baselineLevels) {
      const info = activeMetadata.levels[level];
      if (!info) {
        continue;
      }
      for (let y = 0; y < info.tileRows; y += 1) {
        for (let x = 0; x < info.tileColumns; x += 1) {
          viewportTileCache.prefetch(activeSourceKey, activeTileUrlBase, level, x, y);
        }
      }
    }
  }

  function warmViewportCache(activeSourceKey, activeTileUrlBase, activeMetadata, ringRadius) {
    const tiledImage = viewer?.world.getItemAt(0);
    if (!tiledImage) {
      return;
    }

    const level = Math.max(0, Math.min(maxLevel, optionsLevelForViewport()));
    const bounds = viewer.viewport.getBounds(true);
    const topLeft = tiledImage.viewportToImageCoordinates(bounds.getTopLeft());
    const bottomRight = tiledImage.viewportToImageCoordinates(bounds.getBottomRight());
    const levelInfo = activeMetadata.levels[level];
    const tileSize = activeMetadata.tileSize;
    const scale = levelInfo.width / activeMetadata.width;

    const minTileX = clampTile(Math.floor((topLeft.x * scale) / tileSize) - ringRadius, levelInfo.tileColumns);
    const maxTileX = clampTile(Math.floor((bottomRight.x * scale) / tileSize) + ringRadius, levelInfo.tileColumns);
    const minTileY = clampTile(Math.floor((topLeft.y * scale) / tileSize) - ringRadius, levelInfo.tileRows);
    const maxTileY = clampTile(Math.floor((bottomRight.y * scale) / tileSize) + ringRadius, levelInfo.tileRows);

    for (let tileY = minTileY; tileY <= maxTileY; tileY += 1) {
      for (let tileX = minTileX; tileX <= maxTileX; tileX += 1) {
        viewportTileCache.prefetch(activeSourceKey, activeTileUrlBase, level, tileX, tileY);
      }
    }
  }

  function optionsLevelForViewport() {
    const imageZoom = tiledImageZoom();
    return Math.round(Math.log2(Math.max(1, imageZoom)));
  }

  function tiledImageZoom() {
    const tiledImage = viewer?.world.getItemAt(0);
    if (!tiledImage) {
      return 1;
    }
    return tiledImage.viewportToImageZoom(viewer.viewport.getZoom(true));
  }
}

function updateScaleBar(metadata) {
  const physicalScale = metadata?.physicalScale;
  if (!viewer || !physicalScale?.available || !Number.isFinite(physicalScale.micronsPerPixelX)) {
    hideScaleBar();
    return;
  }

  const tiledImage = viewer.world?.getItemAt(0);
  if (!tiledImage || !viewer.viewport) {
    hideScaleBar();
    return;
  }

  const referenceScreenPx = 100;
  const viewportPointA = viewer.viewport.pointFromPixel(new OpenSeadragon.Point(0, 0), true);
  const viewportPointB = viewer.viewport.pointFromPixel(new OpenSeadragon.Point(referenceScreenPx, 0), true);
  const imagePointA = tiledImage.viewportToImageCoordinates(viewportPointA);
  const imagePointB = tiledImage.viewportToImageCoordinates(viewportPointB);
  const imagePixelsPerScreenPx = Math.abs(imagePointB.x - imagePointA.x) / referenceScreenPx;
  const micronsPerScreenPx = imagePixelsPerScreenPx * physicalScale.micronsPerPixelX;

  if (!Number.isFinite(micronsPerScreenPx) || micronsPerScreenPx <= 0) {
    hideScaleBar();
    return;
  }

  const desiredScreenPx = 110;
  const distanceMicrons = chooseScaleDistanceMicrons(micronsPerScreenPx * desiredScreenPx);
  const widthPx = distanceMicrons / micronsPerScreenPx;

  if (!Number.isFinite(widthPx) || widthPx < 28 || widthPx > 240) {
    hideScaleBar();
    return;
  }

  viewerScaleLabel.textContent = formatScaleDistance(distanceMicrons);
  viewerScaleLine.style.width = `${widthPx.toFixed(1)}px`;
  if (viewerHud) viewerHud.style.display = "flex";
  if (viewerScaleWrap) viewerScaleWrap.style.display = "flex";
}

function hideScaleBar() {
  if (viewerScaleWrap) viewerScaleWrap.style.display = "none";
  if (viewerScaleLabel) viewerScaleLabel.textContent = "-";
  if (viewerScaleLine) viewerScaleLine.style.width = "72px";
}

function chooseScaleDistanceMicrons(targetMicrons) {
  const baseSteps = [0.1, 0.25, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 250, 400, 500, 800];
  const candidates = [];

  for (let multiplier = 1; multiplier <= 1000000; multiplier *= 1000) {
    for (const step of baseSteps) {
      candidates.push(step * multiplier);
    }
  }

  return candidates.reduce((closest, candidate) => {
    const closestDistance = Math.abs(closest - targetMicrons);
    const candidateDistance = Math.abs(candidate - targetMicrons);
    return candidateDistance < closestDistance ? candidate : closest;
  }, candidates[0]);
}

function formatScaleDistance(distanceMicrons) {
  if (distanceMicrons >= 1000) {
    const millimeters = distanceMicrons / 1000;
    return `${formatScaleNumber(millimeters)} mm`;
  }
  return `${formatScaleNumber(distanceMicrons)} µm`;
}

function formatScaleNumber(value) {
  if (value >= 100) {
    return value.toFixed(0);
  }
  if (value >= 10) {
    return Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1);
  }
  if (value >= 1) {
    return Number.isInteger(value) ? value.toFixed(0) : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  }
  return value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function setStatus(message, isError) {
  if (!statusCard) return;
  statusCard.textContent = message;
  statusCard.title = message;
  statusCard.style.color = isError ? "#ffb4b4" : "rgba(245, 247, 250, 0.82)";
  statusCard.style.background = isError ? "rgba(255, 87, 87, 0.08)" : "rgba(255, 255, 255, 0.05)";
  statusCard.style.border = isError ? "1px solid rgba(255, 87, 87, 0.22)" : "1px solid transparent";
}

function setUploading(uploading) {
  if (!uploadButton) return;
  uploadButton.disabled = uploading;
  uploadButton.textContent = uploading ? "Uploading..." : "Upload BIF";
  uploadButton.style.opacity = uploading ? "0.72" : "1";
  uploadButton.style.cursor = uploading ? "progress" : "pointer";
}

function setOpenSlideUploading(uploading) {
  if (!openSlideUploadButton) return;
  openSlideUploadButton.disabled = uploading;
  openSlideUploadButton.textContent = uploading ? "Uploading..." : "Upload OpenSlide";
  openSlideUploadButton.style.opacity = uploading ? "0.72" : "1";
  openSlideUploadButton.style.cursor = uploading ? "progress" : "pointer";
}

function setViewerClosable(enabled) {
  closeViewerButton.disabled = !enabled;
  closeViewerButton.style.opacity = enabled ? "1" : "0.6";
  closeViewerButton.style.cursor = enabled ? "pointer" : "not-allowed";
}

async function loadMetrics() {
  if (metricsPaused) {
    metricsStatus.textContent = "bekliyor";
    metricsStatus.style.background = "rgba(245, 188, 66, 0.18)";
    metricsStatus.style.color = "#ffd98f";
    return;
  }

  try {
    const response = await fetch("/bif-viewer/api/system/metrics", { headers: authHeaders });
    if (!response.ok) {
      throw new Error("Metrics could not be loaded");
    }

    const metrics = await response.json();
    metricsStatus.textContent = "canli";
    metricsStatus.style.background = "rgba(45, 180, 90, 0.18)";
    metricsStatus.style.color = "#b5f3c6";
    metricProcessCpu.textContent = formatPercent(metrics.processCpuLoadPercent);
    metricHeapUsed.textContent = formatBytes(metrics.heapUsedBytes);
    metricFreeRam.textContent = formatBytes(metrics.freePhysicalMemoryBytes);
  } catch {
    metricsStatus.textContent = "hata";
    metricsStatus.style.background = "rgba(255, 87, 87, 0.18)";
    metricsStatus.style.color = "#ffb4b4";
  }
}

function startMetricsPolling() {
  if (metricsTimer) {
    clearInterval(metricsTimer);
  }
  loadMetrics();
  metricsTimer = setInterval(loadMetrics, 5000);
}

function formatPercent(value) {
  if (!Number.isFinite(value)) {
    return "-";
  }
  return `${value.toFixed(value >= 10 ? 1 : 2)}%`;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 1024) {
    return `${bytes || 0} B`;
  }

  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = -1;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(value >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}

function clampTile(value, tileCount) {
  if (tileCount <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(tileCount - 1, value));
}

function createViewportTileCache(maxEntries) {
  let activeSourceKey = null;
  const entries = new Map();
  const inflight = new Map();

  function key(sourceKey, level, x, y) {
    return `${sourceKey}:${level}:${x}:${y}`;
  }

  function networkUrl(tileUrlBase, level, x, y) {
    return `${tileUrlBase}/${level}/${x}/${y}`;
  }

  function touch(cacheKey) {
    const entry = entries.get(cacheKey);
    if (!entry) {
      return;
    }
    entries.delete(cacheKey);
    entries.set(cacheKey, entry);
  }

  function evictIfNeeded() {
    while (entries.size > maxEntries) {
      const oldestKey = entries.keys().next().value;
      const oldest = entries.get(oldestKey);
      if (oldest?.objectUrl) {
        URL.revokeObjectURL(oldest.objectUrl);
      }
      entries.delete(oldestKey);
    }
  }

  function resetForSlide(sourceKey) {
    if (activeSourceKey === sourceKey) {
      return;
    }
    for (const entry of entries.values()) {
      if (entry.objectUrl) {
        URL.revokeObjectURL(entry.objectUrl);
      }
    }
    entries.clear();
    for (const task of inflight.values()) {
      if (task && typeof task.abort === "function") {
        task.abort();
      }
    }
    inflight.clear();
    activeSourceKey = sourceKey;
  }

  async function prefetch(sourceKey, tileUrlBase, level, x, y) {
    if (activeSourceKey !== sourceKey) {
      return;
    }

    const cacheKey = key(sourceKey, level, x, y);
    if (entries.has(cacheKey)) {
      touch(cacheKey);
      return;
    }

    if (inflight.has(cacheKey)) {
      return inflight.get(cacheKey);
    }

    const controller = new AbortController();
    const token = getAccessToken();
    const task = fetch(networkUrl(tileUrlBase, level, x, y), {
      cache: "no-store",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Tile prefetch failed: ${response.status}`);
        }
        return response.blob();
      })
      .then((blob) => {
        if (activeSourceKey !== sourceKey) {
          return;
        }
        const objectUrl = URL.createObjectURL(blob);
        entries.set(cacheKey, { objectUrl });
        evictIfNeeded();
      })
      .catch(() => {})
      .finally(() => {
        inflight.delete(cacheKey);
      });
    task.abort = () => controller.abort();

    inflight.set(cacheKey, task);
    return task;
  }

  function resolveUrl(sourceKey, tileUrlBase, level, x, y) {
    const cacheKey = key(sourceKey, level, x, y);
    const entry = entries.get(cacheKey);
    if (entry?.objectUrl) {
      touch(cacheKey);
      return entry.objectUrl;
    }
    return networkUrl(tileUrlBase, level, x, y);
  }

  return {
    prefetch,
    resetForSlide,
    resolveUrl,
  };
}

function createSelection(kind, slideId) {
  return { kind, slideId };
}

function getSelectedId(kind) {
  return selectedResource?.kind === kind ? selectedResource.slideId : null;
}

function fallbackSelection() {
  if (currentSlides.length) {
    return createSelection("bif", currentSlides[0].slideId);
  }
  if (currentOpenSlideSlides.length) {
    return createSelection("openslide", currentOpenSlideSlides[0].slideId);
  }
  return null;
}

const LAST_SELECTION_STORAGE_KEY = "bifViewer.lastSelection";

// Sayfa yenilendiğinde son açık olan slaytı geri getirebilmek için tarayıcıda saklar.
function persistSelection(selection) {
  try {
    if (selection) {
      localStorage.setItem(LAST_SELECTION_STORAGE_KEY, JSON.stringify(selection));
    } else {
      localStorage.removeItem(LAST_SELECTION_STORAGE_KEY);
    }
  } catch (error) {
    console.warn("Son seçili slayt kaydedilemedi", error);
  }
}

function loadPersistedSelection() {
  try {
    const raw = localStorage.getItem(LAST_SELECTION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && (parsed.kind === "bif" || parsed.kind === "openslide") && parsed.slideId) {
      return createSelection(parsed.kind, parsed.slideId);
    }
  } catch (error) {
    console.warn("Son seçili slayt okunamadı", error);
  }
  return null;
}

/* -------------------------------------------------------------------------
   TARAMA SONUCLARININ KALICI SAKLANMASI
   Otomatik etiketleme / isi haritasi taramasi saatler surebiliyor. Sonuclar
   IndexedDB'de, SLAYT BASINA ayri bir kayitta tutulur:
     * sayfa yenilense, baska slayda gecilse, sekme ya da tarayici tamamen
       kapatilsa bile etiketler ve ilerleme KAYBOLMAZ,
     * her slaydin kendi taramasi vardir; biri digerinin uzerine yazmaz,
     * hicbir kod yolu bu kayitlari silmez.
   IndexedDB kullanilamazsa localStorage'a JSON olarak dusulur.
   ------------------------------------------------------------------------- */

const SCAN_DB_NAME = "bifViewerScans";
const SCAN_DB_STORE = "scans";
const SCAN_FALLBACK_PREFIX = "bifViewer.scan.";
const SCAN_STATE_SAVE_INTERVAL_MS = 4000;
let scanStateSavedAt = 0;
let scanDbPromise = null;

function openScanDb() {
  if (scanDbPromise) return scanDbPromise;
  scanDbPromise = new Promise((resolve) => {
    if (typeof indexedDB === "undefined") {
      resolve(null);
      return;
    }
    let request;
    try {
      request = indexedDB.open(SCAN_DB_NAME, 1);
    } catch (error) {
      console.warn("Tarama veritabanı açılamadı", error);
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SCAN_DB_STORE)) {
        db.createObjectStore(SCAN_DB_STORE, { keyPath: "slideId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      console.warn("Tarama veritabanı açılamadı", request.error);
      resolve(null);
    };
  });
  return scanDbPromise;
}

async function putScanRecord(record) {
  const db = await openScanDb();
  if (db) {
    const stored = await new Promise((resolve) => {
      try {
        const tx = db.transaction(SCAN_DB_STORE, "readwrite");
        tx.objectStore(SCAN_DB_STORE).put(record);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
        tx.onabort = () => resolve(false);
      } catch (error) {
        console.warn("Tarama kaydedilemedi", error);
        resolve(false);
      }
    });
    if (stored) return;
  }
  // IndexedDB yoksa/yazamadiysa localStorage'a dus.
  try {
    localStorage.setItem(SCAN_FALLBACK_PREFIX + record.slideId, JSON.stringify({
      ...record,
      dets: Array.from(record.dets),
    }));
  } catch (error) {
    console.warn("Tarama yedek depoya da kaydedilemedi", error);
  }
}

async function getScanRecord(slideId) {
  const db = await openScanDb();
  if (db) {
    const record = await new Promise((resolve) => {
      try {
        const tx = db.transaction(SCAN_DB_STORE, "readonly");
        const request = tx.objectStore(SCAN_DB_STORE).get(slideId);
        request.onsuccess = () => resolve(request.result ?? null);
        request.onerror = () => resolve(null);
      } catch (error) {
        console.warn("Tarama okunamadı", error);
        resolve(null);
      }
    });
    if (record) return record;
  }
  try {
    const raw = localStorage.getItem(SCAN_FALLBACK_PREFIX + slideId);
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    console.warn("Tarama yedek depodan okunamadı", error);
    return null;
  }
}

// Tespitleri kompakt bir sayi dizisine paketler: sinif adlari sozlukte bir kez
// tutulur, kutular tam sayiya yuvarlanir. IndexedDB tipli diziyi oldugu gibi
// saklayabildigi icin yuz binlerce kutu bile sorunsuz sigar.
function encodeDetections(detections) {
  const classes = [];
  const classIndex = new Map();
  const flat = new Int32Array(detections.length * 6);
  let cursor = 0;
  for (const det of detections) {
    const name = det.class_name ?? "";
    let ci = classIndex.get(name);
    if (ci === undefined) {
      ci = classes.length;
      classes.push(name);
      classIndex.set(name, ci);
    }
    flat[cursor] = Math.round(det.bbox[0]);
    flat[cursor + 1] = Math.round(det.bbox[1]);
    flat[cursor + 2] = Math.round(det.bbox[2]);
    flat[cursor + 3] = Math.round(det.bbox[3]);
    flat[cursor + 4] = ci;
    flat[cursor + 5] = Math.round((det.confidence ?? 0) * 1000);
    cursor += 6;
  }
  return { classes, flat };
}

function decodeDetections(classes, flat) {
  const detections = [];
  if (!Array.isArray(classes) || !flat) return detections;
  for (let i = 0; i + 5 < flat.length; i += 6) {
    detections.push({
      bbox: [flat[i], flat[i + 1], flat[i + 2], flat[i + 3]],
      class_name: classes[flat[i + 4]] ?? "",
      confidence: flat[i + 5] / 1000,
    });
  }
  return detections;
}

// Tarama ilerlemesini + tespitleri kalici depoya yazar. Tarama surerken cok sik
// yazmamak icin kisitlanir; duraklatma/bitis/sayfa kapanisi gibi kritik
// anlarda force ile cagrilir.
function saveScanState({ force = false } = {}) {
  if (!slideScanSlideId) return;
  const now = Date.now();
  if (!force && now - scanStateSavedAt < SCAN_STATE_SAVE_INTERVAL_MS) return;
  scanStateSavedAt = now;
  const { classes, flat } = encodeDetections(autoLabelDetections);
  void putScanRecord({
    slideId: slideScanSlideId,
    complete: slideScanComplete,
    nextIndex: slideScanNextIndex,
    totalCrops: slideScanTotalCrops,
    running: slideScanRunningKind,
    autoLabelVisible,
    heatmapActive,
    classes,
    dets: flat,
    updatedAt: now,
  });
}

// Yalnizca bellekteki gecici geri yukleme kuyrugunu bosaltir. Kalici kayitlara
// DOKUNMAZ — etiketler hicbir zaman silinmez.
function clearScanState() {
  scanStateSavedAt = 0;
  pendingScanRestore = null;
}

// Slayt acilirken bu slayda ait kayitli taramayi bellege geri yukler. Gorsel
// katmanlar viewer "open" olayinda applyScanRestore() ile geri getirilir.
async function restoreScanState(slideId) {
  pendingScanRestore = null;
  if (!slideId) return;
  const record = await getScanRecord(slideId);
  if (!record) return;
  // Kullanici bu arada baska bir slayda gecmis olabilir.
  if (getSelectedEntry()?.slide?.slideId !== slideId) return;

  autoLabelDetections = decodeDetections(record.classes, record.dets);
  slideScanSlideId = slideId;
  slideScanComplete = Boolean(record.complete);
  slideScanNextIndex = Number(record.nextIndex) || 0;
  slideScanTotalCrops = Number(record.totalCrops) || 0;
  slideScanRunningKind = null;
  autoLabelVisible = Boolean(record.autoLabelVisible) && autoLabelDetections.length > 0;
  pendingScanRestore = {
    running: record.running ?? null,
    heatmapActive: Boolean(record.heatmapActive) && autoLabelDetections.length > 0,
  };
}

// Viewer acildiktan sonra geri yuklenen taramanin gorsellerini yerine koyar ve
// gerekiyorsa taramayi kaldigi yerden otomatik surdurur.
function applyScanRestore() {
  const pending = pendingScanRestore;
  pendingScanRestore = null;
  if (!pending) return;
  if (!viewer || !currentMetadata || !viewer.world || viewer.world.getItemCount() === 0) return;

  const progress = !slideScanComplete && slideScanTotalCrops > 0 && slideScanNextIndex > 0
    ? slideScanNextIndex / slideScanTotalCrops
    : null;
  if (progress != null) {
    setToolbarProgress(autoLabelButton, progress);
    setToolbarProgress(heatmapToggleButton, progress);
  }

  if (autoLabelVisible) {
    ensureAutoLabelRedrawLoop();
    redrawAutoLabelOverlay();
  }
  updateAutoLabelButton();

  if (pending.heatmapActive && autoLabelDetections.length) {
    try {
      renderHeatmapFromDetections();
    } catch (error) {
      console.warn("Isı haritası geri yüklenemedi", error);
    }
  }
  updateHeatmapButton();

  const entry = getSelectedEntry();
  if (pending.running && entry && !slideScanComplete) {
    setStatus(`Tarama kaldığı yerden sürdürülüyor (${autoLabelDetections.length} hücre)...`, false);
    if (pending.running === "heatmap") {
      buildHeatmap(entry);
    } else {
      runAutoLabel(entry);
    }
    return;
  }
  if (autoLabelDetections.length) {
    setStatus(
      slideScanComplete
        ? `Önceki tarama geri yüklendi — ${autoLabelDetections.length} hücre.`
        : `Yarım kalan tarama geri yüklendi — ${autoLabelDetections.length} hücre (devam etmek için butona bas).`,
      false
    );
  }
}

/* -------------------------------------------------------------------------
   BILDIRIM (TOAST)
   Uygulamanin cam/blur diliyle uyumlu, kendiliginden kapanan bildirim karti.
   ------------------------------------------------------------------------- */

const TOAST_ICONS = {
  warn: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.9 1.9 18.3A2 2 0 0 0 3.6 21.3h16.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4.6"/><circle cx="12" cy="17.4" r="1.1" fill="currentColor" stroke="none"/></svg>',
  error: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><line x1="9" y1="9" x2="15" y2="15"/><line x1="15" y1="9" x2="9" y2="15"/></svg>',
  info: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5.2"/><circle cx="12" cy="7.8" r="1.1" fill="currentColor" stroke="none"/></svg>',
};

function showToast({ title, message, tone = "warn", duration = 7000 }) {
  let host = document.querySelector("#viewer-toast-host");
  if (!host) {
    host = document.createElement("div");
    host.id = "viewer-toast-host";
    document.body.appendChild(host);
  }
  // Ayni uyari ust uste yiğilmasin.
  for (const old of host.querySelectorAll(".vt-toast")) {
    if (old.dataset.title === title) old.remove();
  }

  const toast = document.createElement("div");
  toast.className = `vt-toast vt-${tone}`;
  toast.dataset.title = title;
  toast.innerHTML = `
    <span class="vt-glow"></span>
    <span class="vt-ico">${TOAST_ICONS[tone] ?? TOAST_ICONS.warn}</span>
    <div class="vt-body">
      <div class="vt-title"></div>
      <div class="vt-msg"></div>
    </div>
    <button class="vt-close" type="button" aria-label="Kapat">&#10005;</button>
    <span class="vt-timer"></span>
  `;
  toast.querySelector(".vt-title").textContent = title;
  // <b> vurgusuna izin ver, geri kalani kacir.
  toast.querySelector(".vt-msg").innerHTML = escapeHtml(message).replace(/&lt;b&gt;/g, "<b>").replace(/&lt;\/b&gt;/g, "</b>");
  const timer = toast.querySelector(".vt-timer");
  timer.style.animationDuration = `${duration}ms`;

  const dismiss = () => {
    if (toast.classList.contains("vt-out")) return;
    toast.classList.add("vt-out");
    window.setTimeout(() => toast.remove(), 260);
  };
  toast.addEventListener("click", dismiss);
  window.setTimeout(dismiss, duration);
  host.appendChild(toast);
  return toast;
}

/* -------------------------------------------------------------------------
   TARAMA KILIDI
   Ayni anda yalnizca tek bir tam slayt taramasi calisabilir. Kullanicinin
   bilerek DURDURDUGU tarama kilidi birakir (baska slaytta yeni tarama
   baslatilabilir); slayt degistirme / sayfa kapatma yuzunden yarida kalan ve
   geri donuldugunde kaldigi yerden devam edecek olan tarama ise kilidi tutar.
   ------------------------------------------------------------------------- */

const ACTIVE_SCAN_STORAGE_KEY = "bifViewer.activeScan";
// Kilit localStorage'da tutulur: tarayici tamamen kapatilip acilsa bile yarim
// kalan tarama "devam ediyor" sayilir ve baska slaytta yenisi baslatilamaz.
const SCAN_KIND_LABEL = {
  heatmap: "ısı haritası çıkarma",
  autolabel: "otomatik etiketleme",
};
// Son iptal, kullanicinin "durdur" basisi miydi?
let scanUserStopped = false;

function readScanClaim() {
  try {
    const raw = localStorage.getItem(ACTIVE_SCAN_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && parsed.slideId ? parsed : null;
  } catch (error) {
    console.warn("Aktif tarama kaydı okunamadı", error);
    return null;
  }
}

function writeScanClaim(entry, kind) {
  try {
    localStorage.setItem(ACTIVE_SCAN_STORAGE_KEY, JSON.stringify({
      slideId: entry.slide.slideId,
      fileName: entry.slide.fileName ?? entry.slide.slideId,
      kind,
      startedAt: Date.now(),
    }));
  } catch (error) {
    console.warn("Aktif tarama kaydı yazılamadı", error);
  }
}

function releaseScanClaim() {
  try {
    localStorage.removeItem(ACTIVE_SCAN_STORAGE_KEY);
  } catch (error) {
    console.warn("Aktif tarama kaydı temizlenemedi", error);
  }
}

// Yeni bir tarama baslatmaya engel olan bir islem var mi?
function findBlockingScan(entry, kind) {
  if (kind !== "heatmap" && heatmapBusy) {
    return { kind: "heatmap", sameSlide: true, fileName: entry.slide.fileName };
  }
  if (kind !== "autolabel" && autoLabelBusy) {
    return { kind: "autolabel", sameSlide: true, fileName: entry.slide.fileName };
  }
  const claim = readScanClaim();
  if (claim && claim.slideId !== entry.slide.slideId) {
    // Kilidin sahibi slayt silinmisse kimse sonsuza dek engellenmesin.
    const stillExists = currentSlides.some((item) => item.slideId === claim.slideId)
      || currentOpenSlideSlides.some((item) => item.slideId === claim.slideId);
    if (!stillExists) {
      releaseScanClaim();
      return null;
    }
    return { ...claim, sameSlide: false };
  }
  return null;
}

function warnBlockingScan(block) {
  const what = SCAN_KIND_LABEL[block.kind] ?? "tarama";
  if (block.sameSlide) {
    showToast({
      tone: "warn",
      title: "Bu slaytta zaten bir tarama sürüyor",
      message: `Şu anda <b>${what}</b> işlemi çalışıyor. Yeni bir işlem başlatmak için önce çalışan taramayı durdur.`,
    });
    setStatus(`Bu slaytta ${what} işlemi zaten sürüyor — önce onu durdur.`, true);
    return;
  }
  showToast({
    tone: "warn",
    title: "Devam eden bir tarama var",
    message: `<b>${block.fileName}</b> dosyasındaki <b>${what}</b> işleminiz hâlâ devam ediyor. Yeni bir tarama başlatmak için önce o slayda dönüp işlemi durdurman gerekiyor.`,
    duration: 9000,
  });
  setStatus(`«${block.fileName}» dosyasında devam eden ${what} işlemi var — önce onu durdur.`, true);
}

function getSelectedEntry() {
  if (!selectedResource) {
    return null;
  }
  if (selectedResource.kind === "bif") {
    const slide = currentSlides.find((item) => item.slideId === selectedResource.slideId);
    return slide ? { kind: "bif", slide } : null;
  }
  const slide = currentOpenSlideSlides.find((item) => item.slideId === selectedResource.slideId);
  return slide ? { kind: "openslide", slide } : null;
}

function selectionKey(selection) {
  return selection ? `${selection.kind}:${selection.slideId}` : null;
}

/* =========================================================================
   BÖLGE SEÇ (CROP / KESIM) — viewer üzerinde kutucuk çizme + panel
   ========================================================================= */

let cropModeActive = false;
let cropSelection = null;       // { x, y, width, height } görsel piksel cinsinden
let cropDrag = null;            // sürükleme anındaki köşeler (görsel px)
let cropOverlay = null;
let cropCanvas = null;
let cropCtx = null;
let cropHint = null;
let cropPanelSlot = null;
let cropToggleButton = null;
let cropToggleLabel = null;
let cropClearToolButton = null;
let cropToolbar = null;
let heatmapToggleButton = null;
let heatmapLegend = null;
let autoLabelToolbar = null;
let autoLabelButton = null;
let cropPreviewOriginal = null; // birleştirilmiş (stitch) orijinal bölge
let cropPreviewClean = null;    // maskeden/efektlerden arındırılmış temiz bölge kopyası (model sonrası etiketli görüntü olabilir)
let cropPreviewPristine = null; // tile'lardan birleştirilen GERÇEK ham bölge — modele her zaman bu gönderilir, asla üzerine yazılmaz
let cropPreviewAnnotated = false; // önizleme etiketli (model) görüntüyle değiştirildi mi
let cropPreviewTileCount = 0;
let cropModelResult = null; // YOLO model çıktısı (detections + summary)
// Aktif kesitin arşiv kimliği. Model çalıştırıldığı anda üretilir; sonraki tüm
// düzenlemeler (taşıma/etiket/silme) annotations.json içinde AYNI bölgeyi
// güncellesin diye kesit boyunca sabit kalır.
let cropRegionId = null;
let cropRegionImagePath = null;
let cropAnnotVisible = false; // ana görselde kutuların görünürlüğü
let cropAnnotScreen = [];     // redraw sırasında hesaplanan ekran koordinatları (hover için)
let cropAnnotHoverIndex = -1; // hover edilen kutu indeksi (pan/zoom sırasında etiket takibi)
let cropEditorOpen = false;   // etiket editörü açık mı
let cropEditorStage = 0;      // editör ekran modu: 0=normal, 1=genişletilmiş, 2=tam ekran
let cropEditorPrevState = null; // genişletmeden önceki konum
let cropEditCanvas = null;    // editördeki resim canvas'ı
let cropEditDrag = null;      // editörde çizim/taşıma durumu
let cropEditDrawMode = false; // editörde yeni kutu çizim modu aktif mi
let cropEditorSize = { w: 0, h: 0 }; // editör pencere boyutu (0 = otomatik/varsayılan)
let cropEditorMinimized = false; // pencere sadece başlık çubuğuna küçültülmüş mü
let cropSelectedAnnot = null; // seçili kutu indeksi (detections)
let cropCustomLabels = [];    // kullanıcının oluşturduğu etiketler
const cropCleanPrev = {};     // kesme sırasında gizlenen öğelerin önceki display değerleri
const CROP_ANNOT_PALETTE = ["#ff1f3d", "#00ff7f", "#00b8ff", "#ffd400", "#ff00e6", "#00fff0", "#ff6600", "#b3ff00", "#ffffff", "#ff00a0"];
const cropClassColorMap = new Map();
let cropClassColorCursor = 0;

function cropAnnotColor(name) {
  const key = String(name ?? "");
  if (key && cropClassColorMap.has(key)) return cropClassColorMap.get(key);
  const color = CROP_ANNOT_PALETTE[cropClassColorCursor % CROP_ANNOT_PALETTE.length];
  cropClassColorCursor += 1;
  if (key) cropClassColorMap.set(key, color);
  return color;
}
let cropPanelStage = 0;          // 0: solda tam sayfa yüksekliğinde bar, 1: tam ekran segment
let cropPanelPrevState = null;
const PANEL_STAGE_SIZES = [
  { w: () => Math.min(420, window.innerWidth - 16), h: () => window.innerWidth < 680 ? Math.max(320, Math.min(540, Math.round(window.innerHeight * 0.66))) : Math.max(400, window.innerHeight - 16) }, // mobilde kompakt kart, masaüstünde tam sayfa bar
  { w: () => window.innerWidth - 16, h: () => window.innerHeight - 16 },
];
let cropPreviewZ = null;        // önizleme için kullanılan seviye
let cropPreviewCanvas = null;
let cropPreviewZoom = 1;        // önizleme yakınlaştırma çarpanı
let cropPreviewPan = { x: 0, y: 0 }; // önizleme kaydırma (görüntü px)
let cropPreviewDrag = null;     // önizlemede sürükleme (pan) durumu
const cropPreviewTileCache = new Map(); // tile URL -> blob (önizleme için istemci önbelleği)
let cropLbZoom = 1;             // ışık kutusu (tam ekran) yakınlaştırma
let cropLbPan = { x: 0, y: 0 }; // ışık kutusu kaydırma
let cropLbDrag = null;          // ışık kutusunda sürükleme (pan) durumu
let cropThresholdValue = 128;
let cropMaskEnabled = false;
let cropPanelOpen = false;
let cropPanelMinimized = false; // pencere sadece başlık çubuğuna küçültülmüş mü
let cropRafId = null;

function injectResponsiveStyles() {
  const style = document.createElement("style");
  style.textContent = `
    @media (max-width: 1180px) {
      .resp-cols { grid-template-columns: 1fr !important; }
      .resp-side { order: 2; }
      .resp-viewer { order: 1; }
      .resp-stage { grid-template-rows: minmax(380px, 62vh) auto !important; }
      #viewer-canvas { min-height: 380px !important; }
      .resp-nav { flex-wrap: wrap; gap: 8px 14px !important; }
    }
    @media (max-width: 900px) {
      .resp-main { padding: 16px !important; }
      .resp-nav { padding: 10px 14px !important; }
      .resp-stage { grid-template-rows: minmax(320px, 56vh) auto !important; }
      #viewer-canvas { min-height: 320px !important; }
      #selected-slide-title { font-size: 1.35rem !important; }
      .resp-cols { gap: 14px !important; }
      .resp-side { gap: 14px !important; }
      #upload-form button, #openslide-upload-form button { flex: 1 !important; justify-content: center; }
    }
    @media (max-width: 600px) {
      .resp-main { padding: 10px !important; }
      .resp-nav { border-radius: 14px !important; }
      .resp-nav > span { font-size: 0.8rem !important; }
      #logout-button { padding: 6px 12px !important; font-size: 0.8rem !important; }
      .resp-stage { grid-template-rows: minmax(260px, 48vh) auto !important; padding: 10px !important; border-radius: 20px !important; }
      #viewer-canvas { min-height: 260px !important; }
      #viewer-stage { border-radius: 18px !important; }
      .resp-metrics { grid-template-columns: 1fr !important; }
      .resp-side article { padding: 16px !important; border-radius: 18px !important; }
      #crop-toolbar { max-width: calc(100vw - 24px); overflow-x: auto; scrollbar-width: none; }
      #crop-toolbar::-webkit-scrollbar { display: none; }
      #crop-hint { white-space: normal !important; max-width: calc(100vw - 24px); top: 52px; }
      #viewer-empty { padding: 12px !important; }
    }
  `;
  document.head.appendChild(style);
}

function injectCropStyles() {
  const style = document.createElement("style");
  style.textContent = `
    #crop-overlay { user-select: none; }
    #crop-overlay.selecting { background: rgba(125,162,255,0.05); }
    .crop-hint { position:absolute; left:50%; top:14px; transform:translateX(-50%); z-index:21; padding:9px 16px; border-radius:999px; background:rgba(6,12,26,0.84); backdrop-filter:blur(10px); border:1px solid rgba(108,165,255,0.5); color:#cfe0ff; font-size:0.82rem; letter-spacing:0.02em; box-shadow:0 10px 30px rgba(0,0,0,0.35); pointer-events:none; white-space:nowrap; }
    .crop-hint .dot { display:inline-block; width:7px; height:7px; border-radius:50%; background:#6ca5ff; margin-right:8px; box-shadow:0 0 12px #6ca5ff; animation:crop-pulse 1.4s ease-in-out infinite; }
    @keyframes crop-pulse { 0%,100%{opacity:1} 50%{opacity:0.35} }

    /* --- Bildirim (toast) — cam efektli, sag ustte yigilir --- */
    #viewer-toast-host { position:fixed; top:18px; left:50%; transform:translateX(-50%); z-index:9999;
      display:flex; flex-direction:column; gap:10px; align-items:center; pointer-events:none; }
    .vt-toast { position:relative; display:flex; align-items:flex-start; gap:13px; width:min(460px, calc(100vw - 32px));
      padding:14px 44px 15px 16px; border-radius:18px; overflow:hidden; pointer-events:auto; cursor:pointer;
      background:rgba(9,14,28,0.86); backdrop-filter:blur(18px); -webkit-backdrop-filter:blur(18px);
      border:1px solid var(--vt-line, rgba(251,191,36,0.45)); color:#f5f7fa;
      box-shadow:0 22px 60px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.07);
      font-family:'SF Pro Display','Segoe UI',sans-serif;
      animation:vtIn .34s cubic-bezier(.22,1.2,.36,1) both, vtNudge .5s ease .34s both; }
    .vt-toast.vt-out { animation:vtOut .26s ease forwards; }
    .vt-toast::before { content:""; position:absolute; left:0; top:0; bottom:0; width:4px; background:var(--vt-accent, #fbbf24); }
    .vt-glow { position:absolute; inset:-60% -20% auto -20%; height:150%; pointer-events:none;
      background:radial-gradient(50% 60% at 20% 0%, var(--vt-glow, rgba(251,191,36,0.30)), transparent 70%); }
    .vt-ico { position:relative; flex:none; display:grid; place-items:center; width:34px; height:34px; border-radius:12px;
      background:var(--vt-icobg, rgba(251,191,36,0.16)); color:var(--vt-accent, #fbbf24);
      border:1px solid var(--vt-line, rgba(251,191,36,0.4)); animation:vtIcoPulse 2.2s ease-in-out infinite; }
    .vt-body { position:relative; min-width:0; }
    .vt-title { font-size:0.92rem; font-weight:800; letter-spacing:0.01em; margin-bottom:3px; }
    .vt-msg { font-size:0.84rem; line-height:1.45; color:rgba(245,247,250,0.74); }
    .vt-msg b { color:#ffe9b8; font-weight:700; }
    .vt-close { position:absolute; top:9px; right:9px; width:24px; height:24px; display:grid; place-items:center;
      border-radius:8px; border:none; background:rgba(255,255,255,0.06); color:rgba(245,247,250,0.6);
      cursor:pointer; font-size:15px; line-height:1; transition:background .16s ease, color .16s ease; }
    .vt-close:hover { background:rgba(255,255,255,0.16); color:#fff; }
    .vt-timer { position:absolute; left:0; bottom:0; height:2px; width:100%; transform-origin:left center;
      background:linear-gradient(90deg, var(--vt-accent, #fbbf24), transparent); animation:vtTimer linear forwards; }
    .vt-toast.vt-error { --vt-accent:#ff6b6b; --vt-line:rgba(255,107,107,0.45); --vt-glow:rgba(255,107,107,0.28); --vt-icobg:rgba(255,107,107,0.16); }
    .vt-toast.vt-info  { --vt-accent:#6ca5ff; --vt-line:rgba(108,165,255,0.45); --vt-glow:rgba(108,165,255,0.26); --vt-icobg:rgba(108,165,255,0.16); }
    @keyframes vtIn { from { opacity:0; transform:translateY(-18px) scale(0.96); } to { opacity:1; transform:none; } }
    @keyframes vtOut { to { opacity:0; transform:translateY(-12px) scale(0.97); } }
    @keyframes vtNudge { 0%,100%{ transform:translateX(0); } 22%{ transform:translateX(-5px); } 45%{ transform:translateX(4px); } 70%{ transform:translateX(-2px); } }
    @keyframes vtIcoPulse { 0%,100%{ box-shadow:0 0 0 0 var(--vt-glow, rgba(251,191,36,0.3)); } 60%{ box-shadow:0 0 0 8px transparent; } }
    @keyframes vtTimer { from { transform:scaleX(1); } to { transform:scaleX(0); } }
    @media (prefers-reduced-motion: reduce) {
      .vt-toast, .vt-ico { animation:none !important; }
    }
    input[type="range"].crop-range { -webkit-appearance:none; appearance:none; width:100%; height:6px; border-radius:999px; background:linear-gradient(90deg,#2f7cf6,#ffb05a); outline:none; cursor:pointer; }
    input[type="range"].crop-range::-webkit-slider-thumb { -webkit-appearance:none; appearance:none; width:20px; height:20px; border-radius:50%; background:radial-gradient(circle at 30% 30%,#ffffff,#c7d6ff 45%,#2f7cf6 100%); border:2px solid rgba(255,255,255,0.92); box-shadow:0 0 0 4px rgba(47,124,246,0.25), 0 5px 16px rgba(0,0,0,0.45); cursor:pointer; transition:transform 120ms ease; }
    input[type="range"].crop-range::-webkit-slider-thumb:hover { transform:scale(1.12); }
    input[type="range"].crop-range::-moz-range-thumb { width:20px; height:20px; border-radius:50%; background:radial-gradient(circle at 30% 30%,#ffffff,#c7d6ff 45%,#2f7cf6 100%); border:2px solid rgba(255,255,255,0.92); box-shadow:0 0 0 4px rgba(47,124,246,0.25), 0 5px 16px rgba(0,0,0,0.45); cursor:pointer; }
    .crop-switch { position:relative; display:inline-block; width:44px; height:24px; }
    .crop-switch input { opacity:0; width:0; height:0; }
    .crop-switch .slider { position:absolute; inset:0; border-radius:999px; background:rgba(255,255,255,0.14); transition:160ms ease; cursor:pointer; border:1px solid rgba(255,255,255,0.12); }
    .crop-switch .slider::before { content:""; position:absolute; width:18px; height:18px; border-radius:50%; left:2px; top:2px; background:#c7d6ff; transition:160ms ease; box-shadow:0 2px 8px rgba(0,0,0,0.4); }
    .crop-switch input:checked + .slider { background:linear-gradient(135deg,#2f7cf6,#6ca5ff); }
    .crop-switch input:checked + .slider::before { transform:translateX(20px); background:#fff; }
    .crop-panel-enter { animation: cropPanelIn 220ms cubic-bezier(0.2,0.9,0.3,1); }
    @keyframes cropPanelIn { from { opacity:0; transform:translateX(-18px) scale(0.98); } to { opacity:1; transform:none; } }
    .crop-json { font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; font-size:0.74rem; line-height:1.5; color:#a9c4ff; white-space:pre-wrap; word-break:break-all; }
    .crop-btn { border-radius:14px; padding:10px 14px; font-weight:700; cursor:pointer; transition:160ms ease; font-size:0.86rem; }
    .crop-btn.primary { border:0; background:linear-gradient(135deg,#6ca5ff,#2f7cf6); color:#04101f; box-shadow:0 10px 26px rgba(47,124,246,0.35); }
    .crop-btn.primary:hover { transform:translateY(-1px); box-shadow:0 14px 32px rgba(47,124,246,0.5); }
    .crop-btn.download { border:1px solid rgba(74,222,128,0.35); background:linear-gradient(135deg, rgba(74,222,128,0.13), rgba(22,163,74,0.07)); color:#9fe8b8; justify-content:center; display:flex; align-items:center; gap:8px; }
    .crop-btn.download:hover { background:linear-gradient(135deg, rgba(74,222,128,0.24), rgba(22,163,74,0.14)); border-color:rgba(74,222,128,0.55); transform:translateY(-1px); }
    .crop-btn.ghost { border:1px solid rgba(125,162,255,0.32); background:rgba(47,124,246,0.12); color:#cfe0ff; }
    .crop-btn.ghost:hover { background:rgba(47,124,246,0.2); }
    .crop-btn.danger { border:1px solid rgba(255,87,87,0.4); background:rgba(255,87,87,0.1); color:#ffb4b4; }
    .crop-btn.danger:hover { background:rgba(255,87,87,0.18); }
    .crop-preview-wrap { height:min(38vh, 460px); min-height:220px; display:flex; align-items:center; justify-content:center; }
    .crop-panel--full .crop-preview-wrap { height:68vh; min-height:420px; border-radius:18px; }
    #crop-preview-canvas { display:block; cursor:zoom-in; touch-action:none; }
    .crop-panel--full .crop-cols { display:grid; grid-template-columns:1.6fr 1fr; gap:14px 18px; align-items:start; }
    .crop-panel--narrow .crop-cols { grid-template-columns:1fr; }
    .crop-panel--full .crop-bottom { display:grid; grid-template-columns:repeat(3, 1fr); gap:8px; align-items:center; }
    .crop-panel--full .crop-bottom > div:first-child { grid-column:1 / -1; }
    .crop-panel--full .crop-bottom > div:first-child .crop-btn { flex:0 0 auto; padding:10px 16px; }
    .crop-panel--full .crop-bottom > div:nth-child(2) { grid-column:1 / -1; }
    .crop-panel--full .crop-bottom > .crop-btn { width:100% !important; margin-top:0 !important; }
    .crop-panel--full #crop-status { grid-column:1 / -1; text-align:center; }
    .crop-panel--full #crop-threshold-input { max-width:320px; }
    .crop-panel--full .crop-preview-wrap { display:grid; place-items:center; }
    .crop-panel--full .crop-panel-scroll { padding:20px 22px; }
    .crop-panel--full #crop-resize-handle { display:none; }
    .crop-editor-body { display:flex; flex-direction:column; gap:12px; }
    .crop-edit-canvas-wrap #crop-edit-canvas { width:100%; height:auto; display:block; }
    .crop-editor--wide .crop-panel-enter, .crop-editor--fullscreen .crop-panel-enter { width:100%; height:100%; max-height:none; border-radius:24px; }
    .crop-editor--wide .crop-editor-body, .crop-editor--fullscreen .crop-editor-body { flex-direction:row; align-items:flex-start; }
    .crop-editor--narrow .crop-editor-body { flex-direction:column; }
    .crop-editor--wide .crop-editor-canvas-col, .crop-editor--fullscreen .crop-editor-canvas-col { flex:1.5; min-width:0; }
    .crop-editor--wide .crop-editor-controls-col, .crop-editor--fullscreen .crop-editor-controls-col { flex:1; min-width:0; }
    .crop-editor--wide .crop-edit-canvas-wrap, .crop-editor--fullscreen .crop-edit-canvas-wrap { max-height:calc(100vh - 170px); display:flex; align-items:flex-start; justify-content:center; }
    .crop-editor--wide .crop-edit-canvas-wrap #crop-edit-canvas, .crop-editor--fullscreen .crop-edit-canvas-wrap #crop-edit-canvas { max-height:calc(100vh - 185px); }
    .crop-editor--fullscreen #crop-editor-resize-handle { display:none; }
    /* Tam ekranda düzenleme resmi mümkün olduğunca büyük olsun diye kontrol paneli
       sabit dar bir kenar çubuğuna alınıyor, kalan tüm alan görüntüye ayrılıyor. */
    .crop-editor--fullscreen .crop-editor-body { padding:14px 16px !important; height:100%; overflow:hidden !important; gap:14px; }
    .crop-editor--fullscreen .crop-editor-canvas-col { flex:1 1 auto; height:100%; gap:6px; }
    .crop-editor--fullscreen .crop-editor-controls-col { flex:0 0 300px; max-width:300px; height:100%; overflow-y:auto; padding-right:4px; }
    .crop-editor--fullscreen .crop-edit-canvas-wrap { flex:1; min-height:0; max-height:none; align-items:center; }
    .crop-editor--fullscreen .crop-edit-canvas-wrap #crop-edit-canvas { max-width:100%; max-height:100%; width:auto; height:auto; }
    /* Görüntünün konforu öncelikli: üstteki başlık satırı ve alttaki ipucu metni
       tam ekranda ekstra bilgi olduğundan kaldırılıp o alan resme veriliyor. */
    .crop-editor--fullscreen #crop-edit-canvas-header { display:none; }
    .crop-editor--fullscreen #crop-edit-hint { display:none; }
    .crop-editor--fullscreen #crop-edit-draw-btn { flex:none; padding:7px 14px; }
    .crop-editor--fullscreen #crop-editor-header { padding:9px 16px !important; }
    @media (max-width: 1100px) {
      .crop-editor--fullscreen .crop-editor-controls-col { flex-basis:270px; max-width:270px; }
    }
    @media (max-width: 680px) {
      .crop-panel-enter, .crop-editor--fullscreen .crop-panel-enter, .crop-editor .crop-panel-enter { border-radius:16px; }
      .crop-panel--full .crop-preview-wrap { height:34vh !important; min-height:220px; }
      .crop-panel--full.crop-panel--narrow .crop-cols, .crop-panel--full .crop-cols { grid-template-columns:1fr !important; }
      .crop-panel--full .crop-bottom { grid-template-columns:1fr !important; }
      .crop-panel--full .crop-bottom > div { grid-column:1 / -1 !important; }
      .crop-panel--full .crop-panel-scroll { padding:12px !important; }
      .crop-panel--full #crop-threshold-input { max-width:none !important; }
      .crop-panel--full .crop-bottom .crop-btn { width:100% !important; padding:11px 14px !important; }
      .crop-editor--wide .crop-editor-body, .crop-editor--fullscreen .crop-editor-body { flex-direction:column !important; padding:12px !important; }
      .crop-editor--wide .crop-edit-canvas-wrap, .crop-editor--fullscreen .crop-edit-canvas-wrap { max-height:34vh; }
      .crop-editor--wide .crop-edit-canvas-wrap #crop-edit-canvas, .crop-editor--fullscreen .crop-edit-canvas-wrap #crop-edit-canvas { max-height:32vh; }
      #crop-panel-header, #crop-editor-header { padding:11px 14px !important; }
      .crop-panel-scroll { padding:12px !important; }
      .tip-btn { width:30px; height:30px; }
    }
    .tb-btn { position:relative; display:flex; align-items:center; justify-content:center; width:38px; height:38px; border-radius:999px; border:1px solid rgba(125,162,255,0.4); background:linear-gradient(135deg, rgba(47,124,246,0.22), rgba(108,165,255,0.10)); color:#cfe0ff; cursor:pointer; padding:0; flex:none; overflow:hidden; transition:width .18s ease, padding .18s ease, background .18s ease, color .18s ease, box-shadow .18s ease, opacity .18s ease; }
    .tb-progress-ring { position:absolute; top:0; left:0; width:38px; height:38px; pointer-events:none; opacity:0; transition:opacity .2s ease; transform:rotate(-90deg); }
    .tb-progress-ring.active { opacity:1; }
    .tb-progress-track { fill:none; stroke:rgba(255,255,255,0.14); stroke-width:2.2; }
    .tb-progress-fill { fill:none; stroke:#4ade80; stroke-width:2.2; stroke-linecap:round; stroke-dasharray:100.53; stroke-dashoffset:100.53; transition:stroke-dashoffset .12s linear; }
    .tb-btn .tb-icon { display:grid; place-items:center; flex:none; width:38px; height:38px; }
    .tb-btn .tb-label { display:block; max-width:0; overflow:hidden; white-space:nowrap; opacity:0; font-size:0.8rem; font-weight:700; transition:max-width .18s ease, opacity .18s ease; }
    .tb-btn:hover { width:auto; padding:0 14px 0 0; }
    .tb-btn:hover .tb-label { max-width:170px; opacity:1; margin-left:1px; }
    .tb-btn.tb-danger { border-color:rgba(255,87,87,0.4); background:rgba(255,87,87,0.10); color:#ffb4b4; }
    .tb-btn.tb-danger:hover { background:rgba(255,87,87,0.2); }
    .tb-btn.tb-annot { border-color:rgba(74,222,128,0.4); background:rgba(74,222,128,0.10); color:#9fe8b8; }
    .tb-btn.tb-annot:hover { background:rgba(74,222,128,0.2); }
    .tb-btn.tb-annot.active { border-color:transparent; background:linear-gradient(135deg,#4ade80,#16a34a); color:#04100a; box-shadow:0 8px 24px rgba(74,222,128,0.45); }
    .tb-btn:disabled { cursor:not-allowed; }

    /* ---------------------------------------------------------------------
       DURUM ODAKLI BUTONLAR (otomatik etiketleme robotu + isi haritasi)
       Her durumun kendi ikonu, kendi rengi ve kendi animasyonu var:
         idle   : sakin, temel renk
         busy   : canli gradyan + donen isik huzmesi + parlama
         paused : kehribar, nabiz gibi atan halka (veri ekranda duruyor)
         hidden : hayalet gorunum, kesik cizgili kenar (katman gecici kalkti)
         done   : yesil / ates gradyani, kisa "pop" animasyonu
       --------------------------------------------------------------------- */
    .tb-btn .tb-ico { display:none; place-items:center; flex:none; position:relative; z-index:2; width:38px; height:38px; }
    .tb-btn[data-state="idle"]   .tb-ico--idle,
    .tb-btn[data-state="busy"]   .tb-ico--busy,
    .tb-btn[data-state="paused"] .tb-ico--paused,
    .tb-btn[data-state="hidden"] .tb-ico--hidden,
    .tb-btn[data-state="done"]   .tb-ico--done { display:grid; animation:tbIconIn .28s cubic-bezier(.34,1.56,.64,1) both; }
    .tb-btn .tb-label { position:relative; z-index:2; }
    .tb-btn .tb-ico.tb-spin svg { animation:tbSpin 1.5s linear infinite; transform-origin:50% 50%; }
    .tb-btn .tb-scanline { animation:tbScan 1.25s ease-in-out infinite; transform-origin:center; }

    /* donen isik huzmesi (yalnizca tarama surerken) */
    .tb-halo { position:absolute; inset:-40%; z-index:0; opacity:0; pointer-events:none;
      background:conic-gradient(from 0deg, transparent 0deg, var(--tb-halo, rgba(255,255,255,0.55)) 42deg, transparent 96deg);
      transition:opacity .25s ease; }
    .tb-btn[data-state="busy"] .tb-halo { opacity:.85; animation:tbSpin 1.9s linear infinite; }
    /* uzerinden gecen parlama */
    .tb-sheen { position:absolute; top:0; bottom:0; width:38%; z-index:1; opacity:0; pointer-events:none;
      background:linear-gradient(100deg, transparent, rgba(255,255,255,0.55), transparent); }
    .tb-btn[data-state="busy"] .tb-sheen,
    .tb-btn[data-state="done"] .tb-sheen { opacity:1; animation:tbSheen 2.6s ease-in-out infinite; }
    .tb-btn[data-state="done"] .tb-sheen { animation-duration:3.6s; }

    /* --- ISI HARITASI --- */
    .tb-btn.tb-heat { --tb-halo:rgba(216,180,254,0.75); border-color:rgba(178,102,255,0.45); background:linear-gradient(135deg, rgba(178,102,255,0.18), rgba(108,165,255,0.08)); color:#e2c9ff; }
    .tb-btn.tb-heat:hover { background:linear-gradient(135deg, rgba(178,102,255,0.32), rgba(108,165,255,0.16)); box-shadow:0 10px 26px rgba(168,85,247,0.32); }
    .tb-btn.tb-heat[data-state="busy"] { --tb-halo:rgba(255,214,170,0.85); border-color:transparent; background:linear-gradient(135deg,#a855f7,#ec4899 55%,#f97316); color:#fff; animation:tbBreathe 1.9s ease-in-out infinite; }
    .tb-btn.tb-heat[data-state="done"] { border-color:transparent; background:linear-gradient(135deg,#f59e0b,#ef4444 60%,#b91c1c); color:#fff; box-shadow:0 8px 26px rgba(239,68,68,0.5); }

    /* --- OTOMATIK ETIKETLEME ROBOTU --- */
    .tb-btn.tb-robot { --tb-halo:rgba(186,230,253,0.85); border-color:rgba(47,124,246,0.5); background:linear-gradient(135deg,#2f7cf6,#6ca5ff); color:#04101f; }
    .tb-btn.tb-robot:hover { background:linear-gradient(135deg,#3a86ff,#7fb2ff); box-shadow:0 10px 26px rgba(47,124,246,0.42); }
    .tb-btn.tb-robot[data-state="busy"] { border-color:transparent; background:linear-gradient(135deg,#06b6d4,#2f7cf6 55%,#8b5cf6); color:#eaf4ff; animation:tbBreathe 1.9s ease-in-out infinite; }
    .tb-btn.tb-robot[data-state="done"] { border-color:transparent; background:linear-gradient(135deg,#4ade80,#16a34a); color:#04100a; box-shadow:0 8px 26px rgba(74,222,128,0.5); }

    /* --- ORTAK DURUMLAR --- */
    .tb-btn[data-state="paused"] { --tb-halo:rgba(253,224,71,0.8); border-color:rgba(251,191,36,0.75); background:linear-gradient(135deg,#f59e0b,#fbbf24); color:#2a1602; box-shadow:0 8px 22px rgba(251,191,36,0.38); animation:tbPulseAmber 2.1s ease-in-out infinite; }
    .tb-btn[data-state="hidden"] { border-style:dashed; border-color:rgba(148,163,184,0.6); background:rgba(148,163,184,0.10); color:rgba(226,232,240,0.72); box-shadow:none; }
    .tb-btn[data-state="hidden"]:hover { background:rgba(148,163,184,0.2); color:#f1f5f9; }
    .tb-btn[data-state="done"] { animation:tbPop .34s cubic-bezier(.34,1.56,.64,1); }
    .tb-btn[data-state="busy"] { cursor:pointer; }
    .tb-btn:active { transform:scale(0.93); }

    /* ilerleme halkasi durumla birlikte renk degistirir */
    .tb-progress-ring { z-index:3; }
    .tb-btn[data-state="paused"] .tb-progress-fill { stroke:#fff7db; }
    .tb-btn[data-state="hidden"] .tb-progress-fill { stroke:rgba(203,213,225,0.9); }
    .tb-btn[data-state="busy"] .tb-progress-fill { stroke:#eaffef; }

    @keyframes tbSpin { to { transform:rotate(360deg); } }
    @keyframes tbSheen { 0% { transform:translateX(-160%) skewX(-18deg); } 55%,100% { transform:translateX(320%) skewX(-18deg); } }
    @keyframes tbBreathe { 0%,100% { box-shadow:0 6px 20px rgba(59,130,246,0.35); } 50% { box-shadow:0 8px 34px rgba(168,85,247,0.75); } }
    @keyframes tbPulseAmber { 0%,100% { box-shadow:0 0 0 0 rgba(251,191,36,0.55); } 60% { box-shadow:0 0 0 8px rgba(251,191,36,0); } }
    @keyframes tbPop { 0% { transform:scale(0.84); } 60% { transform:scale(1.12); } 100% { transform:scale(1); } }
    @keyframes tbIconIn { from { opacity:0; transform:scale(0.55) rotate(-25deg); } to { opacity:1; transform:none; } }
    @keyframes tbScan { 0%,100% { transform:translateY(-2.6px); opacity:0.25; } 50% { transform:translateY(2.6px); opacity:1; } }
    @media (prefers-reduced-motion: reduce) {
      .tb-halo, .tb-sheen { animation:none !important; }
      .tb-btn[data-state="busy"], .tb-btn[data-state="paused"], .tb-btn[data-state="done"] { animation:none !important; }
    }
    #crop-annot-tip { position:absolute; z-index:40; display:none; padding:2px 7px; border-radius:6px; background:rgba(6,12,26,0.92); border:1px solid rgba(125,162,255,0.4); color:#f5f7fa; font-size:0.68rem; font-weight:600; letter-spacing:0.02em; pointer-events:none; white-space:nowrap; box-shadow:0 6px 18px rgba(0,0,0,0.4); }
    .tip-btn { position:relative; display:grid; place-items:center; width:32px; height:32px; border-radius:10px; border:1px solid rgba(245,247,250,0.14); background:rgba(255,255,255,0.04); color:rgba(245,247,250,0.85); cursor:pointer; transition:background .16s ease, color .16s ease, border-color .16s ease, transform .16s ease, box-shadow .16s ease; }
    .tip-btn:hover { background:rgba(255,255,255,0.1); border-color:rgba(125,162,255,0.5); color:#ffffff; transform:translateY(-1px); box-shadow:0 6px 18px rgba(47,124,246,0.3); }
    .tip-btn:active { transform:translateY(0) scale(0.95); }
    .tip-btn.danger:hover { background:rgba(255,87,87,0.14); border-color:rgba(255,87,87,0.5); color:#ffb4b4; box-shadow:0 6px 18px rgba(255,87,87,0.25); }
    .tip-btn.accent:hover { background:rgba(74,222,128,0.12); border-color:rgba(74,222,128,0.5); color:#9fe8b8; box-shadow:0 6px 18px rgba(74,222,128,0.25); }
    [data-tip]::after { content:attr(data-tip); position:absolute; top:calc(100% + 8px); left:50%; transform:translateX(-50%) translateY(-4px); background:rgba(6,12,26,0.96); border:1px solid rgba(125,162,255,0.35); color:#cfe0ff; padding:5px 10px; border-radius:8px; font-size:0.72rem; font-weight:600; white-space:nowrap; opacity:0; pointer-events:none; transition:opacity .15s ease, transform .15s ease; z-index:60; box-shadow:0 10px 26px rgba(0,0,0,0.5); }
    [data-tip]:hover::after { opacity:1; transform:translateX(-50%) translateY(0); }
    .crop-panel-scroll { scrollbar-width: thin; scrollbar-color: rgba(108,165,255,0.55) rgba(255,255,255,0.05); }
    #crop-panel-slot > .crop-panel-enter { width:100%; height:100%; max-height:none; }
    .crop-panel-scroll::-webkit-scrollbar { width: 8px; }
    .crop-panel-scroll::-webkit-scrollbar-track { background: rgba(255,255,255,0.05); border-radius: 999px; }
    .crop-panel-scroll::-webkit-scrollbar-thumb { background: linear-gradient(180deg, #6ca5ff, #2f7cf6); border-radius: 999px; }
    .crop-panel-scroll::-webkit-scrollbar-thumb:hover { background: linear-gradient(180deg, #8fbaff, #4a8df7); }
    #crop-robot-button:hover { transform:scale(1.08); box-shadow:0 12px 30px rgba(47,124,246,0.6); }
    #crop-robot-button:active { transform:scale(0.95); }
    #crop-robot-button.busy { animation: robotPulse 1s ease-in-out infinite; }
    #crop-robot-button.busy #crop-robot-icon { animation: robotSpin 0.9s linear infinite; }
    @keyframes robotPulse { 0%,100% { box-shadow:0 8px 24px rgba(47,124,246,0.45);} 50% { box-shadow:0 8px 32px rgba(74,222,128,0.8);} }
    @keyframes robotSpin { to { transform:rotate(360deg); } }
    #crop-lightbox { position:fixed; inset:0; z-index:9999; background:rgba(2,4,10,0.96); backdrop-filter:blur(10px); }
    #crop-lightbox img { max-width:none; max-height:none; object-fit:fill; }
  `;
  document.head.appendChild(style);
}

function setCropUiEnabled(enabled) {
  if (!cropToggleButton) return;
  cropToggleButton.disabled = !enabled;
  cropToggleButton.style.opacity = enabled ? "1" : "0.55";
  cropToggleButton.style.cursor = enabled ? "pointer" : "not-allowed";
  if (cropToolbar) {
    cropToolbar.style.display = enabled ? "flex" : "none";
  }
  if (!enabled && cropModeActive) {
    setCropMode(false);
  }
  updateCropClearButton();
}

function updateCropClearButton() {
  if (!cropClearToolButton) return;
  const hasSelection = Boolean(cropSelection);
  cropClearToolButton.style.display = hasSelection ? "inline-flex" : "none";
}

function updateCropAnnotToggle() {
  const button = document.querySelector("#crop-annot-toggle-button");
  const label = document.querySelector("#crop-annot-label");
  if (!button) return;
  const has = Boolean(cropModelResult?.detections?.length);
  button.style.display = has ? "inline-flex" : "none";
  button.classList.toggle("active", has && cropAnnotVisible);
  if (label) label.textContent = has && cropAnnotVisible ? "Kutuları Gizle" : "Kutuları Göster";
  if (button.title) button.title = has && cropAnnotVisible ? "Kutuları gizle (eski resmi göster)" : "Kutuları göster";
}

function updateCropOverlayVisibility() {
  if (!cropOverlay) return;
  const show = cropModeActive
    || cropSelection
    || cropDrag
    || (cropAnnotVisible && Boolean(cropModelResult?.detections?.length))
    || ((autoLabelVisible || autoLabelBusy) && autoLabelDetections.length > 0);
  cropOverlay.style.display = show ? "block" : "none";
  // Yalnızca aktif çizim sırasında overlay tüm alanı yakalar (crosshair + pan engeli).
  // Seçim tamamlandıktan sonra overlay varsayılan olarak tıklamaları geçirir ki harita
  // gezilebilsin; fare tutamaç/kutu üzerine geldiğinde onCropAnnotHover overlay'i
  // yeniden "auto" yapıp üste alır (bkz. onCropAnnotHover).
  cropOverlay.style.pointerEvents = cropModeActive ? "auto" : "none";
}

function toggleCropAnnotations() {
  if (!cropModelResult?.detections?.length) return;
  cropAnnotVisible = !cropAnnotVisible;
  updateCropAnnotToggle();
  updateCropOverlayVisibility();
  ensureCropRedrawLoop();
  redrawCropOverlay();
  setStatus(cropAnnotVisible ? "Kutular gösteriliyor." : "Kutular gizlendi — eski orijinal görüntü.", false);
}

// ==================== ETİKET / BOUNDING BOX DÜZENLEYİCİ ====================

function openCropEditor(index) {
  if (!cropModelResult?.detections?.length) {
    setStatus("Önce modele bölge gönder (robot butonu).", true);
    return;
  }
  if (!cropPreviewOriginal?.width) {
    setStatus("Bölge görüntüsü hazır değil — paneli aç.", true);
    return;
  }
cropEditorOpen = true;
  cropSelectedAnnot = index ?? null;
  cropEditorStage = 0;
  cropEditorPrevState = null;
  cropEditorMinimized = false;
  // Önceki oturumdan kalan manuel boyutlandırmayı unut — her açılışta varsayılan
  // (tam yükseklik) boyutla başlasın.
  cropEditorSize = { w: 0, h: 0 };
  renderCropEditor();
  const slot = document.querySelector("#crop-editor-slot");
  if (slot) {
    let left = 8;
    if (cropPanelOpen && cropPanelSlot) {
      const rect = cropPanelSlot.getBoundingClientRect();
      left = Math.min(Math.max(8, rect.right + 16), window.innerWidth - 8);
    }
    cropEditorPrevState = { left, top: 96 };
    setCropEditorStage(0);
    slot.style.display = "block";
  }
  setStatus(index != null ? "Kutu seçildi — etiket ve boyutları düzenle." : "Etiket editörü açıldı.", false);
}

function closeCropEditor() {
  cropEditorOpen = false;
  cropSelectedAnnot = null;
  cropEditDrag = null;
  cropEditDrawMode = false;
  cropEditorStage = 0;
  cropEditorPrevState = null;
  cropEditorMinimized = false;
  cropEditCanvas = null;
  const slot = document.querySelector("#crop-editor-slot");
  if (slot) {
    slot.style.display = "none";
    slot.innerHTML = "";
  }
}

function renderCropEditor() {
  const slot = document.querySelector("#crop-editor-slot");
  if (!slot || !cropModelResult) return;
  const count = cropModelResult.detections?.length ?? 0;
  const selName = cropSelectedAnnot != null ? cropModelResult.detections[cropSelectedAnnot]?.class_name : null;
  const selColor = selName ? cropAnnotColor(selName) : "rgba(245,247,250,0.2)";
  slot.innerHTML = `
    <div class="crop-panel-enter" style="position:relative; width:100%; height:100%; max-width:none; max-height:none; display:flex; flex-direction:column; background:rgba(9,14,28,0.94); backdrop-filter:blur(20px); border:1px solid rgba(125,162,255,0.26); border-radius:22px; box-shadow:0 30px 90px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.06); color:#f5f7fa; overflow:hidden;">
      <div style="flex:none; height:3px; background:linear-gradient(90deg,#4ade80,#2f7cf6,#c084fc);"></div>
      <div id="crop-editor-header" style="flex:none; display:flex; align-items:center; justify-content:space-between; padding:13px 16px; background:linear-gradient(135deg, rgba(74,222,128,0.14), rgba(108,165,255,0.06)); border-bottom:1px solid rgba(125,162,255,0.16); cursor:grab; user-select:none; touch-action:none;">
        <div style="display:flex; align-items:center; gap:10px;">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#4ade80" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex:none;"><rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/></svg>
          <div>
            <div style="font-size:0.68rem; letter-spacing:0.18em; color:#4ade80; text-transform:uppercase;">Manual Annotation</div>
            <div style="font-weight:800; font-size:1rem; margin-top:2px;">Etiket Editörü</div>
          </div>
        </div>
        <div style="display:flex; gap:6px; flex:none;">
          <button id="crop-editor-minimize" type="button" class="tip-btn" data-tip="${cropEditorMinimized ? "Genişlet" : "Küçült"}" title="${cropEditorMinimized ? "Genişlet" : "Küçült"}">
            <svg id="crop-editor-minimize-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${cropEditorMinimized ? '<path d="M6 9l6 6 6-6"/>' : '<path d="M6 15l6-6 6 6"/>'}</svg>
          </button>
          <button id="crop-editor-maximize" type="button" class="tip-btn" data-tip="Tam ekran" title="Tam ekran">
            <svg id="crop-editor-maximize-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/></svg>
          </button>
          <button id="crop-editor-close" type="button" class="tip-btn danger" data-tip="Kapat" title="Kapat">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>
          </button>
        </div>
      </div>
      <div id="crop-editor-body" class="crop-editor-body crop-panel-scroll" style="flex:1; min-height:0; overflow-y:auto; padding:14px; ${cropEditorMinimized ? "display:none;" : ""}">
        <div class="crop-editor-canvas-col" style="display:flex; flex-direction:column; gap:8px; min-width:0;">
          <div id="crop-edit-canvas-header" style="display:flex; align-items:center; justify-content:space-between; flex:none;">
            <span style="font-size:0.78rem; font-weight:800; letter-spacing:0.08em; color:#cfe0ff; text-transform:uppercase;">Bölge Görüntüsü</span>
            <span style="font-size:0.75rem; color:rgba(245,247,250,0.55);">${count} kutu</span>
          </div>
          <div class="crop-edit-canvas-wrap" style="position:relative; border-radius:14px; overflow:hidden; background:#05070d; border:1px solid rgba(125,162,255,0.18);">
            <canvas id="crop-edit-canvas" title="Kutu seç / sürükle / köşelerden boyutlandır" style="display:block; cursor:pointer;"></canvas>
          </div>
          <div id="crop-edit-hint" style="font-size:0.68rem; color:rgba(245,247,250,0.4); text-align:center; flex:none;">Kutuya tıkla: seç · sürükle: taşı · köşelerden genişlet</div>
          <button id="crop-edit-draw-btn" type="button" style="width:100%; display:flex; align-items:center; justify-content:center; gap:8px; border:1px dashed rgba(125,162,255,0.45); border-radius:12px; padding:9px 14px; background:rgba(108,165,255,0.08); color:#cfe0ff; cursor:pointer; font-weight:700; font-size:0.82rem; transition:160ms ease; flex:none;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M12 8v8M8 12h8"/></svg>
            <span>Yeni Kutu Çiz</span>
          </button>
        </div>
        <div class="crop-editor-controls-col" style="display:flex; flex-direction:column; gap:12px; min-width:0;">
          <div id="crop-edit-selected" style="display:none; padding:12px; border-radius:14px; background:rgba(255,255,255,0.04); border:1px solid rgba(125,162,255,0.2);">
            <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:10px;">
              <span style="display:flex; align-items:center; gap:7px; font-size:0.78rem; font-weight:800; letter-spacing:0.08em; color:#7fe3a3; text-transform:uppercase;">
                <span id="crop-edit-sel-dot" style="width:9px; height:9px; border-radius:3px; background:${selColor}; flex:none;"></span>
                Seçili Kutu
              </span>
              <button id="crop-edit-delete" type="button" style="border:1px solid rgba(255,87,87,0.4); border-radius:999px; padding:4px 10px; background:rgba(255,87,87,0.1); color:#ffb4b4; cursor:pointer; font-size:0.72rem; font-weight:700;">Sil</button>
            </div>
            <div style="margin-bottom:10px; position:relative;">
              <div style="font-size:0.7rem; color:rgba(245,247,250,0.5); margin-bottom:4px;">Etiket</div>
              <button id="crop-edit-label-btn" type="button" style="width:100%; display:flex; align-items:center; gap:8px; padding:8px 10px; border-radius:10px; border:1px solid rgba(125,162,255,0.3); background:#0a1122; color:#e6eeff; font-size:0.82rem; outline:none; cursor:pointer;">
                <span id="crop-edit-label-dot" style="width:10px; height:10px; border-radius:3px; background:${selColor}; flex:none;"></span>
                <span id="crop-edit-label-name" style="flex:1; text-align:left; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(selName ?? "—")}</span>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="rgba(207,224,255,0.6)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" style="flex:none;"><path d="M6 9l6 6 6-6"/></svg>
              </button>
              <div id="crop-edit-label-menu" style="position:absolute; top:calc(100% + 6px); left:0; right:0; z-index:20; display:none; max-height:190px; overflow-y:auto; border-radius:12px; border:1px solid rgba(125,162,255,0.35); background:rgba(10,17,34,0.98); box-shadow:0 18px 50px rgba(0,0,0,0.6); scrollbar-width:thin; scrollbar-color:rgba(108,165,255,0.55) rgba(255,255,255,0.05);"></div>
            </div>
            <div style="display:flex; gap:6px; margin-bottom:12px;">
              <input id="crop-edit-new-label" type="text" placeholder="Yeni etiket oluştur..." style="flex:1; min-width:0; padding:7px 10px; border-radius:10px; border:1px solid rgba(125,162,255,0.3); background:#0a1122; color:#e6eeff; font-size:0.8rem; outline:none;" />
              <button id="crop-edit-add-label" type="button" style="border:1px solid rgba(74,222,128,0.4); border-radius:10px; padding:7px 12px; background:rgba(74,222,128,0.12); color:#7fe3a3; cursor:pointer; font-size:0.78rem; font-weight:700; flex:none;">Ekle</button>
            </div>
            <div style="display:grid; grid-template-columns:repeat(4, 1fr); gap:6px;">
              <div style="padding:6px 8px; border-radius:8px; background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.07); text-align:center;">
                <div style="font-size:0.62rem; color:rgba(245,247,250,0.45); text-transform:uppercase; letter-spacing:0.06em;">X</div>
                <div id="crop-edit-x-info" style="font-size:0.8rem; font-weight:800; color:#e6eeff; margin-top:2px;">—</div>
              </div>
              <div style="padding:6px 8px; border-radius:8px; background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.07); text-align:center;">
                <div style="font-size:0.62rem; color:rgba(245,247,250,0.45); text-transform:uppercase; letter-spacing:0.06em;">Y</div>
                <div id="crop-edit-y-info" style="font-size:0.8rem; font-weight:800; color:#e6eeff; margin-top:2px;">—</div>
              </div>
              <div style="padding:6px 8px; border-radius:8px; background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.07); text-align:center;">
                <div style="font-size:0.62rem; color:rgba(245,247,250,0.45); text-transform:uppercase; letter-spacing:0.06em;">Genişlik</div>
                <div id="crop-edit-w-info" style="font-size:0.8rem; font-weight:800; color:#e6eeff; margin-top:2px;">—</div>
              </div>
              <div style="padding:6px 8px; border-radius:8px; background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.07); text-align:center;">
                <div style="font-size:0.62rem; color:rgba(245,247,250,0.45); text-transform:uppercase; letter-spacing:0.06em;">Yükseklik</div>
                <div id="crop-edit-h-info" style="font-size:0.8rem; font-weight:800; color:#e6eeff; margin-top:2px;">—</div>
              </div>
            </div>
          </div>
          <div style="padding:12px; border-radius:14px; background:rgba(255,255,255,0.03); border:1px solid rgba(125,162,255,0.14);">
            <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:8px;">
              <span style="font-size:0.78rem; font-weight:800; letter-spacing:0.08em; color:#cfe0ff; text-transform:uppercase;">Etiketler</span>
              <span id="crop-edit-labels-count" style="font-size:0.72rem; color:rgba(245,247,250,0.5);"></span>
            </div>
            <div id="crop-edit-labels-list" style="display:grid; gap:6px;"></div>
          </div>
        </div>
      </div>
    <div id="crop-editor-resize-handle" title="Sürükleyerek boyutlandır" style="position:absolute; right:3px; bottom:3px; z-index:5; width:18px; height:18px; display:${cropEditorMinimized ? "none" : "grid"}; place-items:center; cursor:nwse-resize; touch-action:none;">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="rgba(125,162,255,0.75)" stroke-width="2.2" stroke-linecap="round"><path d="M18 21l3-3"/><path d="M12 21l9-9"/><path d="M6 21l15-15"/></svg>
      </div>
    </div>
  `;

  document.querySelector("#crop-editor-close")?.addEventListener("click", closeCropEditor);
  document.querySelector("#crop-editor-minimize")?.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleCropEditorMinimized();
  });
  document.querySelector("#crop-editor-maximize")?.addEventListener("click", () => {
    if (cropEditorMinimized) toggleCropEditorMinimized();
    if (cropEditorStage === 0) {
      const r = slot.getBoundingClientRect();
      cropEditorPrevState = { left: r.left, top: r.top };
      cropEditorStage = 1;
    } else {
      cropEditorStage = 0;
    }
    setCropEditorStage(cropEditorStage);
  });
  cropEditCanvas = document.querySelector("#crop-edit-canvas");
  if (cropEditCanvas) {
    cropEditCanvas.addEventListener("pointerdown", cropEditPointerDown);
    cropEditCanvas.addEventListener("pointermove", cropEditCanvasPointerMove);
  }

  const closeLabelMenu = () => {
    const menu = document.querySelector("#crop-edit-label-menu");
    if (menu) menu.style.display = "none";
  };
  document.querySelector("#crop-edit-label-btn")?.addEventListener("click", (ev) => {
    ev.stopPropagation();
    const menu = document.querySelector("#crop-edit-label-menu");
    if (!menu) return;
    const willOpen = menu.style.display !== "block";
    closeLabelMenu();
    if (willOpen) {
      renderCropEditLabelMenu();
      menu.style.display = "block";
    }
  });
  document.querySelector("#crop-edit-label-menu")?.addEventListener("click", (ev) => {
    const item = ev.target.closest("[data-label]");
    if (!item) return;
    applyCropEditLabel(item.dataset.label);
    closeLabelMenu();
  });
  document.addEventListener("click", (ev) => {
    if (!ev.target.closest("#crop-edit-label-btn, #crop-edit-label-menu")) closeLabelMenu();
  });
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") closeLabelMenu();
  });
  document.querySelector("#crop-edit-add-label")?.addEventListener("click", () => {
    const input = document.querySelector("#crop-edit-new-label");
    const name = (input?.value ?? "").trim();
    if (!name) return;
    if (!cropCustomLabels.includes(name)) cropCustomLabels.push(name);
    input.value = "";
    if (cropSelectedAnnot != null && cropModelResult?.detections) {
      applyCropEditLabel(name);
    } else {
      setStatus(`Yeni etiket oluşturuldu: ${name}`, false);
    }
    renderCropEditLabelMenu();
    renderCropEditLabels();
  });
  document.querySelector("#crop-edit-new-label")?.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") document.querySelector("#crop-edit-add-label")?.click();
  });
  const resizeHandle = document.querySelector("#crop-editor-resize-handle");
  if (resizeHandle) {
    resizeHandle.addEventListener("pointerdown", (event) => {
      if (cropEditorStage !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      const startX = event.clientX;
      const startY = event.clientY;
      const rect = slot.getBoundingClientRect();
      const startW = rect.width;
      const startH = rect.height;
      const onMove = (ev) => {
        const w = Math.max(340, Math.min(window.innerWidth - 16, startW + (ev.clientX - startX)));
        const h = Math.max(240, Math.min(window.innerHeight - 16, startH + (ev.clientY - startY)));
        cropEditorSize.w = w;
        cropEditorSize.h = h;
        slot.style.width = `${w}px`;
        slot.style.height = `${h}px`;
        slot.style.maxHeight = "none";
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    });
  }
  document.querySelector("#crop-edit-delete")?.addEventListener("click", () => {
    if (cropSelectedAnnot == null || !cropModelResult?.detections) return;
    const [removed] = cropModelResult.detections.splice(cropSelectedAnnot, 1);
    cropSelectedAnnot = null;
    applyCropAnnotEdits();
    drawCropEditCanvas();
    renderCropEditSelected();
    setStatus("Kutu silindi.", false);
    archiveCropEvent(
      "manual_delete",
      `Kutu silindi: #${removed?.annotId ?? "?"} etiket='${removed?.class_name ?? "?"}'`
    );
  });
  const drawBtn = document.querySelector("#crop-edit-draw-btn");
  drawBtn?.addEventListener("click", () => {
    cropEditDrawMode = !cropEditDrawMode;
    updateCropEditDrawModeUI();
    setStatus(cropEditDrawMode ? "Çizim modu açık — kutu çizmek için sürükle." : "Çizim modu kapalı.", false);
  });
  document.querySelector("#crop-edit-labels-list")?.addEventListener("click", (ev) => {
    const item = ev.target.closest("[data-label]");
    if (!item) return;
    if (cropSelectedAnnot == null || !cropModelResult?.detections) {
      setStatus("Önce resimde bir kutuya tıkla.", true);
      return;
    }
    applyCropEditLabel(item.dataset.label);
  });
  updateCropEditDrawModeUI();

  wireCropEditorDrag();

  drawCropEditCanvas();
  renderCropEditSelected();
  renderCropEditLabelMenu();
  renderCropEditLabels();
  applyCropEditorMinimizedState();
}

function applyCropEditLabel(name) {
  if (cropSelectedAnnot == null || !cropModelResult?.detections) return;
  const relabelTarget = cropModelResult.detections[cropSelectedAnnot];
  const previousLabel = relabelTarget.class_name;
  relabelTarget.class_name = name;
  relabelTarget.manual = true;
  applyCropAnnotEdits();
  drawCropEditCanvas();
  renderCropEditSelected();
  renderCropEditLabels();
  setStatus(`Etiket güncellendi: ${name}`, false);
  archiveCropEvent(
    "manual_relabel",
    `Etiket değiştirildi: #${relabelTarget.annotId ?? "?"} '${previousLabel}' -> '${name}'`
  );
}

const EDITOR_STAGE_SIZES = [
  { w: () => Math.min(440, window.innerWidth - 16), h: () => window.innerWidth < 680 ? Math.max(320, Math.min(560, Math.round(window.innerHeight * 0.7))) : Math.max(400, window.innerHeight - 16) },
  { w: () => window.innerWidth - 16, h: () => window.innerHeight - 16 },
];
const EDITOR_STAGE_ICONS = [
  '<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>',
  '<path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/>',
];
const EDITOR_STAGE_TITLES = ["Tam ekran", "Küçült"];

function applyCropEditorMinimizedState() {
  const slot = document.querySelector("#crop-editor-slot");
  if (!slot) return;
  const panel = slot.querySelector(".crop-panel-enter");
  if (!cropEditorMinimized) return;
  // Küçültülmüşken pencere yalnızca başlık çubuğu kadar yer kaplasın.
  slot.style.height = "auto";
  if (panel) panel.style.height = "auto";
}

function toggleCropEditorMinimized() {
  cropEditorMinimized = !cropEditorMinimized;
  if (cropEditorMinimized) {
    applyCropEditorMinimizedState();
  } else {
    layoutCropEditorSlot();
  }
  const body = document.querySelector("#crop-editor-body");
  if (body) body.style.display = cropEditorMinimized ? "none" : "";
  const resizeHandle = document.querySelector("#crop-editor-resize-handle");
  if (resizeHandle) resizeHandle.style.display = cropEditorMinimized ? "none" : "grid";
  const icon = document.querySelector("#crop-editor-minimize-icon");
  const btn = document.querySelector("#crop-editor-minimize");
  if (icon) icon.innerHTML = cropEditorMinimized ? '<path d="M6 9l6 6 6-6"/>' : '<path d="M6 15l6-6 6 6"/>';
  if (btn) {
    const label = cropEditorMinimized ? "Genişlet" : "Küçült";
    btn.title = label;
    btn.setAttribute("data-tip", label);
  }
}

function layoutCropEditorSlot() {
  const slot = document.querySelector("#crop-editor-slot");
  if (!slot) return;
  const panel = slot.querySelector(".crop-panel-enter");
  const mode = EDITOR_STAGE_SIZES[cropEditorStage] ?? EDITOR_STAGE_SIZES[0];
  let w = typeof mode.w === "function" ? mode.w() : mode.w;
  let h = typeof mode.h === "function" ? mode.h() : mode.h;
  // Manuel boyutlandırma sadece küçük moda uygulanır — tam ekranda her zaman
  // gerçek tam ekran boyutu kullanılır.
  if (cropEditorStage !== 1) {
    if (cropEditorSize?.w) w = Math.min(cropEditorSize.w, window.innerWidth - 16);
    if (cropEditorSize?.h) h = Math.min(cropEditorSize.h, window.innerHeight - 16);
  }
  slot.style.position = "fixed";
  slot.style.margin = "0";
  slot.style.maxWidth = "none";
  slot.style.maxHeight = "none";
  slot.style.width = `${w}px`;
  slot.style.height = `${h}px`;
  if (cropEditorStage === 1) {
    // Tam ekranda pencere zaten neredeyse tüm viewport'u kaplıyor — önceki (küçük
    // moddaki) konumu kullanmaya devam edersek ekranın dışına taşar.
    slot.style.left = "8px";
    slot.style.top = "8px";
  } else {
    const prev = cropEditorPrevState ?? {};
    slot.style.left = `${prev.left ?? 8}px`;
    slot.style.top = `${prev.top ?? 8}px`;
  }
  slot.style.bottom = "auto";
  slot.style.zIndex = cropEditorStage === 1 ? "100" : "40";
  if (panel) {
    panel.style.width = "100%";
    panel.style.height = "100%";
    panel.style.maxWidth = "none";
    panel.style.maxHeight = "none";
    panel.classList.toggle("crop-editor--wide", cropEditorStage === 1);
    panel.classList.toggle("crop-editor--fullscreen", cropEditorStage === 1);
    panel.classList.toggle("crop-editor--narrow", window.innerWidth < 680);
  }
}

function setCropEditorStage(next) {
  cropEditorStage = next;
  layoutCropEditorSlot();
  const icon = document.querySelector("#crop-editor-maximize-icon");
  const btn = document.querySelector("#crop-editor-maximize");
  if (icon) icon.innerHTML = EDITOR_STAGE_ICONS[cropEditorStage] ?? EDITOR_STAGE_ICONS[0];
  if (btn) {
    btn.title = EDITOR_STAGE_TITLES[cropEditorStage] ?? EDITOR_STAGE_TITLES[0];
    btn.setAttribute("data-tip", btn.title);
  }
}

function renderCropEditLabelMenu() {
  const menu = document.querySelector("#crop-edit-label-menu");
  if (!menu || !cropModelResult) return;
  const selected = cropSelectedAnnot != null ? cropModelResult.detections[cropSelectedAnnot]?.class_name : null;
  const all = new Set([...(cropModelResult.model?.classes ?? []), ...cropCustomLabels]);
  const names = [...all].filter(Boolean);
  if (selected && !all.has(selected)) names.push(selected);
  menu.innerHTML = names
    .map(
      (n) => `
      <div data-label="${escapeHtml(n)}" style="display:flex; align-items:center; gap:8px; padding:7px 10px; cursor:pointer; ${n === selected ? "background:rgba(74,222,128,0.12);" : ""}">
        <span style="width:10px; height:10px; border-radius:3px; background:${cropAnnotColor(n)}; flex:none;"></span>
        <span style="font-size:0.8rem; color:#e6eeff; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(n)}</span>
        ${n === selected ? '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#7fe3a3" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" style="flex:none;"><path d="M20 6L9 17l-5-5"/></svg>' : ""}
      </div>`
    )
    .join("");
}

function updateCropEditLabelBtn() {
  const det = cropSelectedAnnot != null ? cropModelResult?.detections?.[cropSelectedAnnot] : null;
  const btnName = document.querySelector("#crop-edit-label-name");
  const btnDot = document.querySelector("#crop-edit-label-dot");
  const selDot = document.querySelector("#crop-edit-sel-dot");
  const color = det ? cropAnnotColor(det.class_name) : "rgba(245,247,250,0.2)";
  if (btnName) btnName.textContent = det ? det.class_name : "—";
  if (btnDot) btnDot.style.background = color;
  if (selDot) selDot.style.background = color;
}

function renderCropEditLabels() {
  const list = document.querySelector("#crop-edit-labels-list");
  const counter = document.querySelector("#crop-edit-labels-count");
  if (!list || !cropModelResult) return;
  const counts = {};
  cropModelResult.detections?.forEach((d) => {
    counts[d.class_name] = (counts[d.class_name] || 0) + 1;
  });
  const names = Object.keys(counts);
  if (counter) counter.textContent = names.length ? `${names.length} etiket` : "";
  list.innerHTML = names.length
    ? names
        .map(
          (name) => `
        <div data-label="${escapeHtml(name)}" title="Seçili kutuya uygula" style="display:flex; align-items:center; gap:8px; padding:6px 8px; border-radius:8px; cursor:pointer; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.06); transition:background .14s ease, border-color .14s ease;">
          <span style="width:10px; height:10px; border-radius:3px; background:${cropAnnotColor(name)}; flex:none;"></span>
          <span style="font-size:0.78rem; color:#e6eeff; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(name)}</span>
          <span style="font-size:0.68rem; color:rgba(245,247,250,0.45); flex:none;">${counts[name]}</span>
        </div>`
        )
        .join("")
    : '<div style="font-size:0.78rem; color:rgba(245,247,250,0.45); padding:6px 0;">Henüz etiket yok — modeli çalıştır veya kutu çiz.</div>';
}

function wireCropEditorDrag() {
  const header = document.querySelector("#crop-editor-header");
  const slot = document.querySelector("#crop-editor-slot");
  if (!header || !slot) return;
  header.addEventListener("pointerdown", (event) => {
    if (event.target.closest("button, select, input")) return;
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    const rect = slot.getBoundingClientRect();
    const startLeft = rect.left;
    const startTop = rect.top;
    const panelW = rect.width;
    const panelH = rect.height;
    const maxLeft = Math.max(8, window.innerWidth - panelW - 8);
    const maxTop = Math.max(8, window.innerHeight - panelH - 8);
    slot.style.position = "fixed";
    slot.style.left = `${startLeft}px`;
    slot.style.top = `${startTop}px`;
    slot.style.bottom = "auto";
    slot.style.margin = "0";
    header.style.cursor = "grabbing";
    const onMove = (ev) => {
      const nx = Math.min(Math.max(8, startLeft + (ev.clientX - startX)), maxLeft);
      const ny = Math.min(Math.max(8, startTop + (ev.clientY - startY)), maxTop);
      slot.style.left = `${nx}px`;
      slot.style.top = `${ny}px`;
    };
    const onUp = () => {
      header.style.cursor = "grab";
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  });
}

function selectCropEditAnnot(index) {
  if (index < 0 || !cropModelResult?.detections || index >= cropModelResult.detections.length) return;
  cropSelectedAnnot = index;
  renderCropEditSelected();
  drawCropEditCanvas();
}

function renderCropEditSelected() {
  const box = document.querySelector("#crop-edit-selected");
  if (!box) return;
  const det = cropSelectedAnnot != null ? cropModelResult?.detections?.[cropSelectedAnnot] : null;
  if (!det) {
    box.style.display = "none";
    return;
  }
  box.style.display = "block";
  const [x1, y1, x2, y2] = det.bbox;
  const info = {
    "crop-edit-x-info": Math.round(x1),
    "crop-edit-y-info": Math.round(y1),
    "crop-edit-w-info": Math.round(x2 - x1),
    "crop-edit-h-info": Math.round(y2 - y1),
  };
  for (const [id, val] of Object.entries(info)) {
    const el = document.querySelector(`#${id}`);
    if (el) el.textContent = val;
  }
  updateCropEditLabelBtn();
}

function updateCropEditDrawModeUI() {
  const drawBtn = document.querySelector("#crop-edit-draw-btn");
  if (drawBtn) {
    drawBtn.style.border = cropEditDrawMode
      ? "1px solid rgba(74,222,128,0.55)"
      : "1px dashed rgba(125,162,255,0.45)";
    drawBtn.style.background = cropEditDrawMode ? "rgba(74,222,128,0.14)" : "rgba(108,165,255,0.08)";
    drawBtn.style.color = cropEditDrawMode ? "#7fe3a3" : "#cfe0ff";
  }
  const hint = document.querySelector("#crop-edit-hint");
  if (hint) hint.textContent = cropEditDrawMode ? "Çizim modu: sürükleyerek yeni kutu çiz" : "Kutuya tıkla: seç · sürükle: taşı · köşelerden genişlet";
  if (cropEditCanvas) cropEditCanvas.style.cursor = cropEditDrawMode ? "crosshair" : "pointer";
}

function cropEditPointerDown(event) {
  if (!cropEditCanvas || !cropModelResult?.detections || !cropPreviewOriginal) return;
  event.preventDefault();
  const pt = cropEditEventToImage(event);
  if (!pt) return;
  if (cropEditDrawMode) {
    cropSelectedAnnot = null;
    cropEditDrag = { mode: "draw", x0: pt.x, y0: pt.y, x1: pt.x, y1: pt.y };
  } else {
    const handle = cropEditHandleAt(pt);
    if (handle) {
      const det = cropModelResult.detections[cropSelectedAnnot];
      const [x1, y1, x2, y2] = det.bbox;
      const pts = cropEditHandlePoints(det);
      const [hx, hy] = pts[handle];
      cropEditDrag = { mode: "resize", idx: cropSelectedAnnot, handle, ox1: x1, oy1: y1, ox2: x2, oy2: y2, dx: pt.x - hx, dy: pt.y - hy };
    } else {
      const hit = cropModelResult.detections.findIndex((det) => {
        const [x1, y1, x2, y2] = det.bbox;
        return pt.x >= x1 && pt.x <= x2 && pt.y >= y1 && pt.y <= y2;
      });
      if (hit < 0) return;
      cropSelectedAnnot = hit;
      const [x1, y1] = cropModelResult.detections[hit].bbox;
      cropEditDrag = { mode: "move", idx: hit, dx: pt.x - x1, dy: pt.y - y1 };
    }
  }
  renderCropEditSelected();
  window.addEventListener("pointermove", cropEditPointerMove);
  window.addEventListener("pointerup", cropEditPointerUp);
  drawCropEditCanvas();
}

function cropEditEventToImage(event) {
  if (!cropEditCanvas || !cropPreviewOriginal) return null;
  const rect = cropEditCanvas.getBoundingClientRect();
  if (rect.width === 0) return null;
  return {
    x: (event.clientX - rect.left) * (cropPreviewOriginal.width / rect.width),
    y: (event.clientY - rect.top) * (cropPreviewOriginal.height / rect.height),
  };
}

function cropEditPointerMove(event) {
  if (!cropEditDrag || !cropModelResult?.detections) return;
  const pt = cropEditEventToImage(event);
  if (!pt) return;
  const imgW = cropPreviewOriginal.width;
  const imgH = cropPreviewOriginal.height;
  if (cropEditDrag.mode === "draw") {
    cropEditDrag.x1 = Math.max(0, Math.min(imgW, pt.x));
    cropEditDrag.y1 = Math.max(0, Math.min(imgH, pt.y));
  } else if (cropEditDrag.mode === "move") {
    const det = cropModelResult.detections[cropEditDrag.idx];
    if (det) {
      const [x1, y1, x2, y2] = det.bbox;
      const w = x2 - x1;
      const h = y2 - y1;
      const nx = Math.max(0, Math.min(imgW - w, pt.x - cropEditDrag.dx));
      const ny = Math.max(0, Math.min(imgH - h, pt.y - cropEditDrag.dy));
      det.bbox = [nx, ny, nx + w, ny + h];
      det.manual = true;
      drawCropEditCanvas();
    }
  } else if (cropEditDrag.mode === "resize") {
    const det = cropModelResult.detections[cropEditDrag.idx];
    if (det) {
      const { handle, ox1, oy1, ox2, oy2, dx, dy } = cropEditDrag;
      const MIN = 8;
      const px = pt.x - dx;
      const py = pt.y - dy;
      let nx1 = ox1;
      let ny1 = oy1;
      let nx2 = ox2;
      let ny2 = oy2;
      if (handle.includes("w")) nx1 = Math.max(0, Math.min(px, ox2 - MIN));
      if (handle.includes("e")) nx2 = Math.min(imgW, Math.max(px, ox1 + MIN));
      if (handle.includes("n")) ny1 = Math.max(0, Math.min(py, oy2 - MIN));
      if (handle.includes("s")) ny2 = Math.min(imgH, Math.max(py, oy1 + MIN));
      det.bbox = [nx1, ny1, nx2, ny2];
      det.manual = true;
      drawCropEditCanvas();
    }
  }
}

function cropEditCanvasPointerMove(event) {
  if (!cropEditCanvas || cropEditDrawMode || cropEditDrag) {
    if (cropEditCanvas) cropEditCanvas.style.cursor = cropEditDrawMode ? "crosshair" : "pointer";
    return;
  }
  const pt = cropEditEventToImage(event);
  if (!pt) return;
  const handle = cropEditHandleAt(pt);
  let cursor = "pointer";
  if (handle) {
    cursor = handle.includes("n") || handle.includes("s")
      ? handle.includes("w") || handle.includes("e")
        ? handle === "nw" || handle === "se" ? "nwse-resize" : "nesw-resize"
        : "ns-resize"
      : handle === "w" || handle === "e"
        ? "ew-resize"
        : "pointer";
  } else {
    const hit = cropModelResult?.detections?.findIndex((det) => {
      const [x1, y1, x2, y2] = det.bbox;
      return pt.x >= x1 && pt.x <= x2 && pt.y >= y1 && pt.y <= y2;
    });
    if (hit >= 0) cursor = "move";
  }
  cropEditCanvas.style.cursor = cursor;
}

function cropEditPointerUp() {
  window.removeEventListener("pointermove", cropEditPointerMove);
  window.removeEventListener("pointerup", cropEditPointerUp);
  if (!cropEditDrag || !cropModelResult) return;
  const drag = cropEditDrag;
  cropEditDrag = null;
  if (drag.mode === "draw") {
    const x = Math.round(Math.min(drag.x0, drag.x1));
    const y = Math.round(Math.min(drag.y0, drag.y1));
    const w = Math.round(Math.abs(drag.x1 - drag.x0));
    const h = Math.round(Math.abs(drag.y1 - drag.y0));
    if (w >= 4 && h >= 4) {
      const modelClasses = cropModelResult.model?.classes ?? [];
      const defaultLabel = modelClasses[0] ?? "etiket-yok";
      const classId = modelClasses.indexOf(defaultLabel);
      cropModelResult.detections.push({
        class_id: classId >= 0 ? classId : -1,
        class_name: defaultLabel,
        confidence: null,
        bbox: [x, y, x + w, y + h],
        manual: true,
      });
      cropSelectedAnnot = cropModelResult.detections.length - 1;
      const addedBox = cropModelResult.detections[cropSelectedAnnot];
      ensureAnnotationIds([addedBox]);
      applyCropAnnotEdits();
      renderCropEditSelected();
      cropEditDrawMode = false;
      updateCropEditDrawModeUI();
      setStatus(`Yeni kutu eklendi — etiketini seç: ${defaultLabel}`, false);
      archiveCropEvent(
        "manual_new_box",
        `Yeni kutu eklendi: #${addedBox.annotId} etiket='${defaultLabel}' `
          + `kesit-içi bbox=[${addedBox.bbox.map((v) => Math.round(v)).join(",")}]`
      );
    }
  } else if (drag.mode === "move" || drag.mode === "resize") {
    applyCropAnnotEdits();
    renderCropEditSelected();
    const editedBox = cropModelResult?.detections?.[drag.idx];
    archiveCropEvent(
      drag.mode === "move" ? "manual_move" : "manual_resize",
      `${drag.mode === "move" ? "Kutu taşındı" : "Kutu boyutlandırıldı"}: `
        + `#${editedBox?.annotId ?? "?"} etiket='${editedBox?.class_name ?? "?"}' `
        + `kesit-içi bbox=[${(editedBox?.bbox ?? []).map((v) => Math.round(v)).join(",")}]`
    );
  }
  drawCropEditCanvas();
}

function drawCropEditCanvas() {
  if (!cropEditCanvas || !cropPreviewOriginal) return;
  const ctx = cropEditCanvas.getContext("2d");
  cropEditCanvas.width = cropPreviewOriginal.width;
  cropEditCanvas.height = cropPreviewOriginal.height;
  ctx.drawImage(cropPreviewOriginal, 0, 0);
  if (cropModelResult?.detections) {
    cropModelResult.detections.forEach((det, i) => {
      const [x1, y1, x2, y2] = det.bbox;
      const color = cropAnnotColor(det.class_name);
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = i === cropSelectedAnnot ? 2.5 : 2;
      if (i === cropSelectedAnnot) ctx.setLineDash([6, 4]);
      ctx.strokeRect(x1 + 1, y1 + 1, Math.max(0, x2 - x1 - 2), Math.max(0, y2 - y1 - 2));
      ctx.restore();
    });
  }
  if (cropSelectedAnnot != null && cropModelResult?.detections?.[cropSelectedAnnot]) {
    drawCropEditHandles(ctx, cropModelResult.detections[cropSelectedAnnot]);
  }
  if (cropEditDrag?.mode === "draw") {
    const x = Math.min(cropEditDrag.x0, cropEditDrag.x1);
    const y = Math.min(cropEditDrag.y0, cropEditDrag.y1);
    const w = Math.abs(cropEditDrag.x1 - cropEditDrag.x0);
    const h = Math.abs(cropEditDrag.y1 - cropEditDrag.y0);
    ctx.save();
    ctx.strokeStyle = "#4ade80";
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 4]);
    ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
    ctx.restore();
  }
}

function cropEditHandlePx() {
  if (!cropEditCanvas || !cropPreviewOriginal) return 8;
  const rect = cropEditCanvas.getBoundingClientRect();
  if (rect.width === 0) return 8;
  return 9 * (cropPreviewOriginal.width / rect.width);
}

function cropEditHandlePoints(det) {
  const [x1, y1, x2, y2] = det.bbox;
  const cx = (x1 + x2) / 2;
  const cy = (y1 + y2) / 2;
  return {
    nw: [x1, y1], n: [cx, y1], ne: [x2, y1],
    e: [x2, cy], se: [x2, y2], s: [cx, y2],
    sw: [x1, y2], w: [x1, cy],
  };
}

function drawCropEditHandles(ctx, det) {
  const hp = cropEditHandlePx();
  const pts = cropEditHandlePoints(det);
  ctx.save();
  for (const [hx, hy] of Object.values(pts)) {
    ctx.fillStyle = "#f5f7fa";
    ctx.strokeStyle = "#2f7cf6";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.rect(hx - hp / 2, hy - hp / 2, hp, hp);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

function cropEditHandleAt(pt) {
  if (cropSelectedAnnot == null || !cropModelResult?.detections?.[cropSelectedAnnot]) return null;
  const det = cropModelResult.detections[cropSelectedAnnot];
  const hp = cropEditHandlePx();
  const pts = cropEditHandlePoints(det);
  const r = hp / 2 + 3;
  for (const [name, [hx, hy]] of Object.entries(pts)) {
    if (Math.abs(pt.x - hx) <= r && Math.abs(pt.y - hy) <= r) return name;
  }
  return null;
}

function applyCropAnnotEdits() {
  if (!cropModelResult) return;
  cropModelResult.total = cropModelResult.detections?.length ?? 0;
  cropModelResult.summary = {};
  for (const det of cropModelResult.detections ?? []) {
    cropModelResult.summary[det.class_name] = (cropModelResult.summary[det.class_name] ?? 0) + 1;
  }
  updateCropJsonView();
  redrawCropOverlay();
  applyCropPreviewFx();
  renderCropResults(cropModelResult);
  updateCropAnnotToggle();
  const badge = document.querySelector("#crop-model-badge");
  if (badge && cropModelResult) {
    badge.textContent = `${cropModelResult.total} hücre`;
  }
  if (cropAnnotVisible) ensureCropRedrawLoop();
}

function setCropCleanView(active) {
  const ids = ["crop-toolbar", "viewer-hud", "heatmap-legend", "crop-hint", "viewer-canvas-navigator"];
  for (const id of ids) {
    const el = document.getElementById(id) ?? (id === "viewer-canvas-navigator" ? document.querySelector("#viewer-canvas .navigator") : null);
    if (!el) continue;
    if (active && el.style.display !== "none") {
      cropCleanPrev[id] = el.style.display;
      el.style.display = "none";
    } else if (!active && cropCleanPrev[id] !== undefined) {
      el.style.display = cropCleanPrev[id];
      delete cropCleanPrev[id];
    }
  }
}

/* =========================================================================
   ISI HARİTASI (HEATMAP) — tüm slayt üzerinde hücre yoğunluğu
   ========================================================================= */

async function toggleHeatmap() {
  const entry = getSelectedEntry();
  if (!entry || !viewer || !currentMetadata || !viewer.world || viewer.world.getItemCount() === 0) {
    setStatus("Önce bir slayt açmalısın.", true);
    return;
  }
  // Buton döngüsü:
  //   1) tarama sürerken bas  -> taramayı durdur (harita ekranda kalır)
  //   2) tekrar bas           -> haritayı geçici olarak kaldır (veri korunur)
  //   3) tekrar bas           -> taramayı kaldığı yerden sürdür (harita geri gelir)
  // Tarama tamamlandıysa buton klasik göster/gizle anahtarı olur.
  if (heatmapBusy) {
    // Tarama sürerken tekrar tıklamak taramayı durdurur (eldeki tespitlerle çizilir).
    // Bilerek durdurulan tarama kilidi bırakır — baska slaytta yenisi baslatilabilir.
    scanUserStopped = true;
    heatmapAbort?.abort();
    setStatus("Isı haritası durduruluyor...", false);
    return;
  }
  if (hasPausedScan(entry)) {
    if (heatmapActive) {
      hideHeatmap();
      setStatus("Isı haritası geçici olarak kaldırıldı — devam etmek için tekrar bas.", false);
      return;
    }
    await buildHeatmap(entry);
    return;
  }
  if (heatmapActive) {
    hideHeatmap();
    return;
  }
  if (heatmapCache) {
    showHeatmap();
    return;
  }
  await buildHeatmap(entry);
}

// Tüm slaytı tam çözünürlükte 640x640 karolarla tarar ve bulunan hücreleri
// SLAYT piksel koordinatlarında biriktirir. Isı haritası ile otomatik
// etiketleme birebir aynı taramaya ihtiyaç duyduğu için ikisi de bu fonksiyonu
// kullanır; sonuç paylaşılan bir önbellekte tutulur, böylece biri çalıştıktan
// sonra diğeri anında (yeniden tarama yapmadan) sonuç verir.
//
// Tarama durdurulabilir ve KALDIĞI YERDEN devam ettirilebilir: her karodan
// sonra sıradaki karo indeksi saklanır, böylece dakikalarca süren bir tarama
// yarıda kesilse bile baştan başlamak gerekmez.
async function scanWholeSlide(entry, { signal, button, statusPrefix, onProgress }) {
  const slideId = entry.slide.slideId;
  const maxSize = 2000;
  const overviewUrl = entry.kind === "openslide"
    ? `/bif-viewer/api/openslide/${encodeURIComponent(slideId)}/overview?maxSize=${maxSize}`
    : `/bif-viewer/api/slides/${encodeURIComponent(slideId)}/overview?maxSize=${maxSize}`;
  const tileUrlBase = entry.kind === "openslide"
    ? `/bif-viewer/api/openslide/tiles/${encodeURIComponent(slideId)}`
    : `/bif-viewer/api/tiles/${encodeURIComponent(slideId)}`;

  // Aynı slaytın yarım kalmış taraması varsa kaldığı yerden devam et.
  const resuming = slideScanSlideId === slideId && !slideScanComplete && slideScanNextIndex > 0;
  if (!resuming) {
    slideScanSlideId = slideId;
    slideScanNextIndex = 0;
    autoLabelDetections = [];
  }
  slideScanComplete = false;

  setStatus(`${statusPrefix} — ${resuming ? "kaldığı yerden devam ediliyor" : "genel görünüm alınıyor"}...`, false);
  const overviewResponse = await fetch(overviewUrl, { headers: currentAuthHeaders() });
  if (!overviewResponse.ok) {
    throw new Error(`Genel görünüm alınamadı (${overviewResponse.status})`);
  }
  const overviewImage = await loadImageFromBlob(await overviewResponse.blob());
  const overviewWidth = overviewImage.naturalWidth;
  const overviewHeight = overviewImage.naturalHeight;
  if (!overviewWidth || !overviewHeight) {
    throw new Error("Genel görünüm çözümlenemedi");
  }

  const slideWidth = currentMetadata.width;
  const slideHeight = currentMetadata.height;
  const tileSize = currentMetadata.tileSize;
  const levels = currentMetadata.levels || [];
  const fullResLevel = levels.reduce((best, lvl) => (!best || lvl.width > best.width ? lvl : best), null);
  if (!fullResLevel) {
    throw new Error("Slayt seviye bilgisi bulunamadı");
  }

  // Boş cam alanlarını modele hiç göndermemek için hızlı doku maskesi.
  const tissueFraction = buildTissueMask(overviewImage, overviewWidth, overviewHeight, slideWidth, slideHeight);

  const cropSize = 640; // modelin eğitim çözünürlüğü — en doğru sonuç
  const cols = Math.ceil(slideWidth / cropSize);
  const rows = Math.ceil(slideHeight / cropSize);
  const totalCrops = cols * rows;
  slideScanTotalCrops = totalCrops;
  const token = getAccessToken();

  const startIndex = resuming ? Math.min(slideScanNextIndex, totalCrops) : 0;
  let scanned = 0;

  for (let index = startIndex; index < totalCrops; index += 1) {
    if (signal?.aborted) throw new Error("aborted");
    const rx = index % cols;
    const ry = Math.floor(index / cols);
    const px0 = rx * cropSize;
    const py0 = ry * cropSize;
    const w = Math.min(cropSize, slideWidth - px0);
    const h = Math.min(cropSize, slideHeight - py0);

    const processed = index + 1;
    setToolbarProgress(button, processed / totalCrops);
    if (processed % 8 === 0 || processed === totalCrops) {
      setStatus(
        `${statusPrefix} — karo ${processed}/${totalCrops} (hücre: ${autoLabelDetections.length})`,
        false
      );
      onProgress?.();
    }

    if (tissueFraction(px0, py0, w, h) >= 0.02) {
      scanned += 1;
      try {
        const cropCanvas = await fetchSlideRegionCanvas(tileUrlBase, fullResLevel.z, tileSize, token, px0, py0, w, h);
        const cropBlob = await new Promise((resolve) => cropCanvas.toBlob(resolve, "image/jpeg", 0.9));
        if (cropBlob) {
          const predictionResponse = await fetch("/bif-viewer/model-api/predict?imgsz=640", {
            method: "POST",
            headers: {
              "Content-Type": "image/jpeg",
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: cropBlob,
            signal,
          });
          if (predictionResponse.ok) {
            const result = await predictionResponse.json();
            for (const det of result.detections || []) {
              const [bx1, by1, bx2, by2] = det.bbox;
              autoLabelDetections.push({
                bbox: [px0 + bx1, py0 + by1, px0 + bx2, py0 + by2],
                class_name: det.class_name,
                confidence: det.confidence,
              });
            }
          }
        }
      } catch (err) {
        if (signal?.aborted) throw err;
        // tek bir karonun başarısız olması taramanın tamamını durdurmasın
      }
    }

    // Bu karo bitti; durdurulursa buradan devam edilecek.
    slideScanNextIndex = index + 1;
    // Sekme yenilense bile buradan devam edebilmek için ilerlemeyi sakla.
    saveScanState();
  }

  slideScanComplete = true;
  slideScanNextIndex = totalCrops;
  saveScanState({ force: true });
  return { scanned, totalCrops };
}

// Paylaşılan tarama bu slayt için TAMAMLANMIŞ mı?
function hasSlideScan(entry) {
  return slideScanComplete
    && slideScanSlideId === entry.slide.slideId
    && autoLabelDetections.length > 0;
}

// Bu slayt için yarıda kalmış (devam ettirilebilir) bir tarama var mı?
function hasPausedScan(entry) {
  return !slideScanComplete
    && slideScanSlideId === entry.slide.slideId
    && slideScanNextIndex > 0;
}

// Tarama basladigi slayt hala ekranda ve viewer cizime hazir mi?
function isScanEntryActive(entry) {
  return getSelectedEntry()?.slide?.slideId === entry?.slide?.slideId
    && Boolean(viewer && currentMetadata && viewer.world && viewer.world.getItemCount() > 0);
}

async function buildHeatmap(entry) {
  // Ayni anda tek tarama: baska bir slaytta (ya da bu slaytta) durdurulmamis
  // bir islem varsa yenisine izin verme.
  const blocking = findBlockingScan(entry, "heatmap");
  if (blocking) {
    warnBlockingScan(blocking);
    return;
  }
  heatmapBusy = true;
  const heatmapController = new AbortController();
  heatmapAbort = heatmapController;
  slideScanRunningKind = "heatmap";
  scanUserStopped = false;
  writeScanClaim(entry, "heatmap");
  updateHeatmapButton();
  let abortedMidScan = false;
  try {
    let scanInfo = null;
    if (hasSlideScan(entry)) {
      // Otomatik etiketleme (ya da önceki bir tarama) zaten tüm slaytı taramış —
      // yeniden taramaya gerek yok, ısı haritası anında çıkar.
      setStatus(`Isı haritası — mevcut tarama kullanılıyor (${autoLabelDetections.length} hücre)...`, false);
    } else {
      scanInfo = await scanWholeSlide(entry, {
        signal: heatmapController.signal,
        button: heatmapToggleButton,
        statusPrefix: "Isı haritası",
      });
    }

    if (!isScanEntryActive(entry)) return;
    renderHeatmapFromDetections();

    setStatus(
      autoLabelDetections.length
        ? `Isı haritası hazır — ${autoLabelDetections.length} hücre${scanInfo ? ` (${scanInfo.scanned}/${scanInfo.totalCrops} karo tarandı)` : " (mevcut tarama kullanıldı)"}.`
        : "Isı haritası hazır — model hücre tespit edemedi.",
      false
    );
  } catch (error) {
    abortedMidScan = heatmapController.signal.aborted;
    if (!isScanEntryActive(entry)) {
      // Slayt kapandi/degisti — eski slaydin haritasini yenisinin uzerine cizme.
    } else if (autoLabelDetections.length) {
      // Yarıda kesilse bile eldeki tespitlerle harita çizilebilir.
      renderHeatmapFromDetections();
      setStatus(`Isı haritası durduruldu — ${autoLabelDetections.length} hücre ile çizildi.`, true);
    } else {
      setStatus(`Isı haritası hatası: ${error.message}`, true);
      hideHeatmapLegend();
    }
  } finally {
    heatmapBusy = false;
    heatmapAbort = null;
    slideScanRunningKind = null;
    // Kilit yalnizca "geri donuldugunde devam edecek" tarama icin tutulur:
    // kullanici bilerek durdurduysa ya da tarama bittiyse serbest birakilir.
    if (!(abortedMidScan && !scanUserStopped)) releaseScanClaim();
    scanUserStopped = false;
    updateHeatmapButton();
    if (slideScanComplete) setToolbarProgress(heatmapToggleButton, null);
    saveScanState({ force: true });
  }
}

// Paylaşılan tespit listesinden yoğunluk ızgarası kurup slaytın üzerine
// yarı saydam bir ısı haritası katmanı yerleştirir.
function renderHeatmapFromDetections() {
  const slideWidth = currentMetadata.width;
  const slideHeight = currentMetadata.height;

  const gridColumns = 256;
  const gridRows = Math.max(16, Math.round((gridColumns * slideHeight) / slideWidth));
  const grid = new Float32Array(gridColumns * gridRows);
  const gridScaleX = gridColumns / slideWidth;
  const gridScaleY = gridRows / slideHeight;

  for (const det of autoLabelDetections) {
    const [bx1, by1, bx2, by2] = det.bbox;
    const centerX = (bx1 + bx2) / 2;
    const centerY = (by1 + by2) / 2;
    const boxW = Math.max(4, bx2 - bx1);
    const boxH = Math.max(4, by2 - by1);
    const sigma = Math.min(10, Math.max(1.2, Math.max(boxW, boxH) * Math.max(gridScaleX, gridScaleY) * 0.35));
    addGaussianSplat(grid, gridColumns, gridRows, centerX * gridScaleX, centerY * gridScaleY, sigma);
  }

  const smoothed = smoothDensityGrid(grid, gridColumns, gridRows, 6);

  let maxDensity = 0;
  for (let i = 0; i < smoothed.length; i += 1) {
    if (smoothed[i] > maxDensity) maxDensity = smoothed[i];
  }
  if (maxDensity <= 0) maxDensity = 1;
  const percentileCap = densityPercentile(smoothed, 0.9);
  const normalizeBy = Math.max(maxDensity * 0.35, percentileCap, 1e-6);

  const gridCanvas = document.createElement("canvas");
  gridCanvas.width = gridColumns;
  gridCanvas.height = gridRows;
  const gridContext = gridCanvas.getContext("2d");
  const imageData = gridContext.createImageData(gridColumns, gridRows);
  for (let i = 0; i < smoothed.length; i += 1) {
    const raw = Math.min(1, smoothed[i] / normalizeBy);
    const intensity = Math.pow(raw, 0.55);
    const [red, green, blue] = heatmapColor(intensity);
    const alpha = intensity <= 0.02 ? 0 : 0.25 + Math.min(1, intensity * 1.15) * 0.65;
    imageData.data[i * 4] = red;
    imageData.data[i * 4 + 1] = green;
    imageData.data[i * 4 + 2] = blue;
    imageData.data[i * 4 + 3] = Math.round(alpha * 255);
  }
  gridContext.putImageData(imageData, 0, 0);

  const renderCanvas = document.createElement("canvas");
  renderCanvas.width = Math.min(2048, gridColumns * 8);
  renderCanvas.height = Math.min(2048, gridRows * 8);
  const renderContext = renderCanvas.getContext("2d");
  renderContext.imageSmoothingEnabled = true;
  renderContext.drawImage(gridCanvas, 0, 0, renderCanvas.width, renderCanvas.height);

  const overlayElement = document.createElement("img");
  overlayElement.src = renderCanvas.toDataURL("image/png");
  overlayElement.style.pointerEvents = "none";
  overlayElement.alt = "Isı haritası";

  // Önceki katman varsa kaldır (yeniden çizimde çift katman olmasın).
  if (heatmapCache?.overlayAdded && heatmapCache.element) {
    try {
      viewer.removeOverlay(heatmapCache.element);
    } catch {
      /* zaten kaldırılmış olabilir */
    }
  }

  const heatmapTiledImage = viewer.world.getItemAt(0);
  const heatmapViewportRect = heatmapTiledImage.imageToViewportRectangle(
    new OpenSeadragon.Rect(0, 0, slideWidth, slideHeight)
  );
  viewer.addOverlay({
    element: overlayElement,
    location: heatmapViewportRect,
  });

  heatmapCache = { element: overlayElement, overlayAdded: true };
  heatmapActive = true;
  showHeatmapLegend();
  updateHeatmapButton();
}


function showHeatmap() {
  if (!heatmapCache) return;
  heatmapActive = true;
  if (heatmapCache.overlayAdded && heatmapCache.element) {
    heatmapCache.element.style.display = "block";
  } else if (viewer && currentMetadata && heatmapCache.element) {
    const tiledImage = viewer.world.getItemAt(0);
    const viewportRect = tiledImage.imageToViewportRectangle(
      new OpenSeadragon.Rect(0, 0, currentMetadata.width, currentMetadata.height)
    );
    viewer.addOverlay({
      element: heatmapCache.element,
      location: viewportRect,
    });
    heatmapCache.overlayAdded = true;
  }
  showHeatmapLegend();
  updateHeatmapButton();
  saveScanState({ force: true });
}

function hideHeatmap() {
  heatmapActive = false;
  if (heatmapCache?.overlayAdded && heatmapCache.element && viewer) {
    try {
      viewer.removeOverlay(heatmapCache.element);
    } catch (error) {
      console.warn("Isı haritası overlay kaldırılamadı", error);
    }
    heatmapCache.overlayAdded = false;
  }
  hideHeatmapLegend();
  updateHeatmapButton();
  saveScanState({ force: true });
}

function resetHeatmap() {
  heatmapAbort?.abort();
  heatmapAbort = null;
  hideHeatmap();
  heatmapCache = null;
  heatmapBusy = false;
  setToolbarProgress(heatmapToggleButton, null);
}

function showHeatmapLegend() {
  if (!heatmapLegend) return;
  heatmapLegend.style.display = "block";
}

function hideHeatmapLegend() {
  if (!heatmapLegend) return;
  heatmapLegend.style.display = "none";
}

const TB_PROGRESS_RING_CIRCUMFERENCE = 2 * Math.PI * 16;

// Yuvarlak araç çubuğu düğmesinin etrafına ilerleme halkası çizer (yılan gibi
// çembere sarılır). fraction 0-1 arası; null/undefined verilirse halka gizlenir.
function setToolbarProgress(button, fraction) {
  const ring = button?.querySelector(".tb-progress-ring");
  const fill = button?.querySelector(".tb-progress-fill");
  if (!ring || !fill) return;
  if (fraction == null) {
    ring.classList.remove("active");
    return;
  }
  ring.classList.add("active");
  const clamped = Math.max(0, Math.min(1, fraction));
  fill.style.strokeDashoffset = String(TB_PROGRESS_RING_CIRCUMFERENCE * (1 - clamped));
}

function updateHeatmapButton() {
  if (!heatmapToggleButton) return;
  const label = heatmapToggleButton.querySelector(".tb-label");
  const paused = !heatmapBusy && !slideScanComplete && slideScanNextIndex > 0;

  // Butonun görsel durumu: her biri kendi ikonu/rengi/animasyonu ile.
  let state = "idle";
  if (heatmapBusy) state = "busy";
  else if (paused) state = heatmapActive ? "paused" : "hidden";
  else if (heatmapActive) state = "done";
  else if (heatmapCache) state = "hidden";
  setToolbarButtonState(heatmapToggleButton, state);

  // Tarama sürerken buton tıklanabilir kalmalı ki kullanıcı durdurabilsin.
  heatmapToggleButton.disabled = false;
  const titles = {
    busy: "Taranıyor — durdurmak için tıkla",
    paused: "Tarama duraklatıldı — haritayı geçici kaldırmak için tıkla",
    hidden: paused
      ? "Isı haritası kaldırıldı — taramaya devam etmek için tıkla"
      : "Isı haritasını göster",
    done: "Isı haritasını gizle",
    idle: "Isı haritasını göster",
  };
  const labels = {
    busy: "Durdur",
    paused: "Haritayı Kaldır",
    hidden: paused ? "Devam Et" : "Haritayı Göster",
    done: "Haritayı Gizle",
    idle: "Isı Haritası",
  };
  heatmapToggleButton.title = titles[state];
  if (label) {
    label.textContent = state === "idle"
      ? labels[state]
      : withCellCount(labels[state], autoLabelDetections.length);
  }
}

// Genel görünüm üzerinde hızlı bir doku maskesi çıkarır ve herhangi bir
// slayt-piksel dikdörtgeninin doku (boş cam olmayan) piksel oranını O(1)
// sürede döndüren bir fonksiyon verir. Isı haritası ve otomatik etiketleme
// taramalarında boş cam karolarını atlamak için kullanılır.
function buildTissueMask(overviewImage, overviewWidth, overviewHeight, slideWidth, slideHeight, threshold = 214) {
  const maskCanvas = document.createElement("canvas");
  maskCanvas.width = overviewWidth;
  maskCanvas.height = overviewHeight;
  const maskContext = maskCanvas.getContext("2d");
  maskContext.drawImage(overviewImage, 0, 0);
  const pixels = maskContext.getImageData(0, 0, overviewWidth, overviewHeight).data;
  // Satır bazlı integral (prefix-sum) tablo.
  const integral = new Float64Array((overviewWidth + 1) * (overviewHeight + 1));
  for (let y = 0; y < overviewHeight; y += 1) {
    let rowSum = 0;
    for (let x = 0; x < overviewWidth; x += 1) {
      const idx = (y * overviewWidth + x) * 4;
      const gray = (pixels[idx] + pixels[idx + 1] + pixels[idx + 2]) / 3;
      rowSum += gray < threshold ? 1 : 0;
      integral[(y + 1) * (overviewWidth + 1) + (x + 1)] = integral[y * (overviewWidth + 1) + (x + 1)] + rowSum;
    }
  }
  const ovScaleX = overviewWidth / slideWidth;
  const ovScaleY = overviewHeight / slideHeight;
  return function tissueFraction(px0, py0, pw, ph) {
    const x0 = Math.max(0, Math.min(overviewWidth, Math.floor(px0 * ovScaleX)));
    const y0 = Math.max(0, Math.min(overviewHeight, Math.floor(py0 * ovScaleY)));
    const x1 = Math.max(x0, Math.min(overviewWidth, Math.ceil((px0 + pw) * ovScaleX)));
    const y1 = Math.max(y0, Math.min(overviewHeight, Math.ceil((py0 + ph) * ovScaleY)));
    const area = (x1 - x0) * (y1 - y0);
    if (area <= 0) return 0;
    const w1 = overviewWidth + 1;
    return (
      (integral[y1 * w1 + x1] - integral[y0 * w1 + x1] - integral[y1 * w1 + x0] + integral[y0 * w1 + x0]) / area
    );
  };
}

/* =========================================================================
   OTOMATİK ETİKETLEME — tüm slaytı 640x640 karolara bölüp tam çözünürlükte
   tek tek modele göndererek her hücreyi işaretler.
   ========================================================================= */

// Slayt piksel uzayında keyfi bir (tile ızgarasıyla hizalı olmayan) dikdörtgeni,
// gerekli 512px'lik karoları indirip birleştirerek tam boyutlu bir canvas olarak döndürür.
async function fetchSlideRegionCanvas(tileUrlBase, level, tileSize, token, px0, py0, w, h) {
  const startTx = Math.floor(px0 / tileSize);
  const endTx = Math.floor((px0 + w - 1) / tileSize);
  const startTy = Math.floor(py0 / tileSize);
  const endTy = Math.floor((py0 + h - 1) / tileSize);
  const tilesX = endTx - startTx + 1;
  const tilesY = endTy - startTy + 1;

  const stitchCanvas = document.createElement("canvas");
  stitchCanvas.width = tilesX * tileSize;
  stitchCanvas.height = tilesY * tileSize;
  const stitchCtx = stitchCanvas.getContext("2d");

  const tileImages = await Promise.all(
    Array.from({ length: tilesX * tilesY }, (_, i) => {
      const tx = startTx + (i % tilesX);
      const ty = startTy + Math.floor(i / tilesX);
      const url = `${tileUrlBase}/${level}/${tx}/${ty}`;
      return fetch(url, { cache: "no-store", headers: token ? { Authorization: `Bearer ${token}` } : {} })
        .then((r) => (r.ok ? r.blob() : null))
        .then((blob) => (blob ? loadImageFromBlob(blob) : null))
        .catch(() => null);
    })
  );
  tileImages.forEach((img, i) => {
    if (!img) return;
    const dx = (i % tilesX) * tileSize;
    const dy = Math.floor(i / tilesX) * tileSize;
    stitchCtx.drawImage(img, dx, dy);
  });

  const outCanvas = document.createElement("canvas");
  outCanvas.width = w;
  outCanvas.height = h;
  outCanvas
    .getContext("2d")
    .drawImage(stitchCanvas, px0 - startTx * tileSize, py0 - startTy * tileSize, w, h, 0, 0, w, h);
  return outCanvas;
}

async function toggleAutoLabel() {
  const entry = getSelectedEntry();
  if (!entry || !viewer || !currentMetadata || !viewer.world || viewer.world.getItemCount() === 0) {
    setStatus("Önce bir slayt açmalısın.", true);
    return;
  }
  // Buton döngüsü:
  //   1) tarama sürerken bas  -> taramayı durdur (etiketler ekranda kalır)
  //   2) tekrar bas           -> etiketleri geçici olarak kaldır (veri korunur)
  //   3) tekrar bas           -> taramayı kaldığı yerden sürdür (etiketler geri gelir)
  // Tarama tamamlandıysa buton klasik göster/gizle anahtarı olur.
  if (autoLabelBusy) {
    // Bilerek durdurulan tarama kilidi bırakır.
    scanUserStopped = true;
    autoLabelAbort?.abort();
    setStatus("Otomatik etiketleme durduruluyor...", false);
    return;
  }
  if (hasPausedScan(entry)) {
    if (autoLabelVisible) {
      setAutoLabelVisible(false);
      setStatus("Etiketler geçici olarak kaldırıldı — devam etmek için tekrar bas.", false);
      return;
    }
    await runAutoLabel(entry);
    return;
  }
  if (hasSlideScan(entry)) {
    setAutoLabelVisible(!autoLabelVisible);
    setStatus(autoLabelVisible ? "Etiketler gösteriliyor." : "Etiketler gizlendi.", false);
    return;
  }
  await runAutoLabel(entry);
}

// Etiket katmanını aç/kapat — veri (autoLabelDetections) hiç silinmez, sadece
// çizim gizlenir; durum sekme ömrü boyunca saklanır.
function setAutoLabelVisible(visible) {
  autoLabelVisible = visible;
  updateAutoLabelButton();
  if (autoLabelVisible) ensureAutoLabelRedrawLoop();
  redrawAutoLabelOverlay();
  saveScanState({ force: true });
}

async function runAutoLabel(entry) {
  // Ayni anda tek tarama: baska bir slaytta (ya da bu slaytta) durdurulmamis
  // bir islem varsa yenisine izin verme.
  const blocking = findBlockingScan(entry, "autolabel");
  if (blocking) {
    warnBlockingScan(blocking);
    return;
  }
  autoLabelBusy = true;
  const autoLabelController = new AbortController();
  autoLabelAbort = autoLabelController;
  slideScanRunningKind = "autolabel";
  scanUserStopped = false;
  writeScanClaim(entry, "autolabel");
  updateAutoLabelButton();
  ensureAutoLabelRedrawLoop();
  let scanInfo = null;
  let abortedMidScan = false;
  try {
    if (hasSlideScan(entry)) {
      // Isı haritası (ya da önceki bir tarama) tüm slaytı zaten taramış —
      // kutuları yeniden taramadan anında göster.
      setStatus(`Otomatik etiketleme — mevcut tarama kullanıldı (${autoLabelDetections.length} hücre).`, false);
    } else {
      scanInfo = await scanWholeSlide(entry, {
        signal: autoLabelController.signal,
        button: autoLabelButton,
        statusPrefix: "Otomatik etiketleme",
        onProgress: () => redrawAutoLabelOverlay(),
      });
      setStatus(
        `Otomatik etiketleme tamam — ${autoLabelDetections.length} hücre işaretlendi (${scanInfo.scanned}/${scanInfo.totalCrops} karo tarandı).`,
        false
      );
    }
    autoLabelVisible = true;
  } catch (error) {
    abortedMidScan = autoLabelController.signal.aborted;
    if (autoLabelDetections.length) {
      autoLabelVisible = true;
      setStatus(
        `Otomatik etiketleme durduruldu — şimdiye kadar ${autoLabelDetections.length} hücre işaretlendi.`,
        true
      );
    } else {
      setStatus(`Otomatik etiketleme hatası: ${error.message}`, true);
    }
  } finally {
    autoLabelBusy = false;
    autoLabelAbort = null;
    slideScanRunningKind = null;
    if (!(abortedMidScan && !scanUserStopped)) releaseScanClaim();
    scanUserStopped = false;
    // Yarim kalan taramada halka kaldigi yerde kalsin (nerede durdugu gorunsun).
    if (slideScanComplete) setToolbarProgress(autoLabelButton, null);
    updateAutoLabelButton();
    redrawAutoLabelOverlay();
    saveScanState({ force: true });
  }
}

function resetAutoLabel() {
  autoLabelAbort?.abort();
  autoLabelAbort = null;
  autoLabelVisible = false;
  autoLabelBusy = false;
  autoLabelDetections = [];
  // Paylaşılan tarama da geçersiz olur (yeni slayt / kapatma).
  slideScanSlideId = null;
  slideScanComplete = false;
  slideScanNextIndex = 0;
  stopAutoLabelRedrawLoop();
  if (autoLabelToolbar) autoLabelToolbar.style.display = "none";
  setToolbarProgress(autoLabelButton, null);
  updateAutoLabelButton();
  redrawAutoLabelOverlay();
}

function updateAutoLabelButton() {
  if (!autoLabelButton) return;
  const label = autoLabelButton.querySelector(".tb-label");
  const paused = !autoLabelBusy && !slideScanComplete && slideScanNextIndex > 0;
  const done = !autoLabelBusy && slideScanComplete && autoLabelDetections.length > 0;

  // Butonun görsel durumu: her biri kendi ikonu/rengi/animasyonu ile.
  let state = "idle";
  if (autoLabelBusy) state = "busy";
  else if (paused) state = autoLabelVisible ? "paused" : "hidden";
  else if (done) state = autoLabelVisible ? "done" : "hidden";
  setToolbarButtonState(autoLabelButton, state);

  const titles = {
    busy: "Taranıyor — durdurmak için tıkla",
    paused: "Tarama duraklatıldı — etiketleri geçici kaldırmak için tıkla",
    hidden: paused
      ? "Etiketler kaldırıldı — taramaya devam etmek için tıkla"
      : "Etiketleri göster",
    done: "Etiketleri gizle",
    idle: "Tüm slaytı otomatik etiketle (640x640 karolarla tam çözünürlük tarama)",
  };
  const labels = {
    busy: "Taranıyor...",
    paused: "Etiketleri Kaldır",
    hidden: paused ? "Devam Et" : "Etiketleri Göster",
    done: "Etiketleri Gizle",
    idle: "Otomatik Etiketle",
  };
  autoLabelButton.title = titles[state];
  if (label) {
    label.textContent = state === "idle"
      ? labels[state]
      : withCellCount(labels[state], autoLabelDetections.length);
  }
}

// Araç çubuğu düğmesinin görsel durumunu ayarlar. data-state CSS tarafından
// okunur (ikon seçimi, renk teması, animasyon); yalnızca gerçekten değiştiğinde
// yazılır, böylece animasyonlar her çizimde baştan başlamaz.
function setToolbarButtonState(button, state) {
  if (!button) return;
  if (button.dataset.state !== state) {
    button.dataset.state = state;
  }
  button.classList.toggle("active", state === "done");
  button.classList.toggle("busy", state === "busy");
}

// "Etiketleri Gizle · 12.480" — bulunan hücre sayısını etikete iliştirir.
function withCellCount(text, count) {
  return count > 0 ? `${text} · ${count.toLocaleString("tr-TR")}` : text;
}

// Otomatik etiketleme kutuları ayrı bir canvas yerine crop overlay'in
// (redrawCropOverlay) içinde çizilir — crop yolunun pan/zoom sırasında
// kutuları dokuya kilitli tuttuğu kanıtlandı.
function redrawAutoLabelOverlay() {
  updateCropOverlayVisibility();
  redrawCropOverlay();
}

function ensureAutoLabelRedrawLoop() {
  updateCropOverlayVisibility();
  ensureCropRedrawLoop();
  redrawCropOverlay();
}

function stopAutoLabelRedrawLoop() {
  updateCropOverlayVisibility();
  redrawCropOverlay();
}

function loadImageFromBlob(blob) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Genel görünüm yüklenemedi"));
    };
    image.src = objectUrl;
  });
}

// Klasik ısı haritası: mavi -> camgöbeği -> yeşil -> sarı -> turuncu -> kırmızı (yoğunluk arttıkça ısınır)
function heatmapColor(intensity) {
  const stops = [
    [0, 0, 190],
    [0, 140, 255],
    [0, 220, 220],
    [0, 210, 0],
    [255, 235, 0],
    [255, 140, 0],
    [255, 0, 0],
  ];
  const position = Math.max(0, Math.min(1, intensity)) * (stops.length - 1);
  const index = Math.min(stops.length - 2, Math.floor(position));
  const fraction = position - index;
  const from = stops[index];
  const to = stops[index + 1];
  return [
    Math.round(from[0] + (to[0] - from[0]) * fraction),
    Math.round(from[1] + (to[1] - from[1]) * fraction),
    Math.round(from[2] + (to[2] - from[2]) * fraction),
  ];
}

function densityPercentile(values, fraction) {
  const sorted = Float32Array.from(values).sort();
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round(sorted.length * fraction)));
  return sorted[index];
}

function addGaussianSplat(grid, columns, rows, centerX, centerY, sigma) {
  const radius = Math.ceil(sigma * 3);
  const minX = Math.max(0, Math.floor(centerX - radius));
  const maxX = Math.min(columns - 1, Math.ceil(centerX + radius));
  const minY = Math.max(0, Math.floor(centerY - radius));
  const maxY = Math.min(rows - 1, Math.ceil(centerY + radius));
  const inverseSigma2 = 1 / (2 * sigma * sigma);
  for (let y = minY; y <= maxY; y += 1) {
    const dy = y - centerY;
    for (let x = minX; x <= maxX; x += 1) {
      const dx = x - centerX;
      const distance2 = dx * dx + dy * dy;
      grid[y * columns + x] += Math.exp(-distance2 * inverseSigma2);
    }
  }
}

function smoothDensityGrid(source, columns, rows, passes) {
  let data = new Float32Array(source);
  for (let pass = 0; pass < passes; pass += 1) {
    const output = new Float32Array(columns * rows);
    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < columns; x += 1) {
        let sum = 0;
        let count = 0;
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx >= 0 && nx < columns && ny >= 0 && ny < rows) {
              sum += data[ny * columns + nx];
              count += 1;
            }
          }
        }
        output[y * columns + x] = sum / count;
      }
    }
    data = output;
  }
  return data;
}

function toggleCropMode() {
  if (cropModeActive) {
    setCropMode(false);
    setStatus("Seçim tamamlandı — bölge kilitlendi.", false);
    return;
  }
  if (!viewer || !viewer.world || viewer.world.getItemCount() === 0) {
    setStatus("Önce bir slayt açmalısın.", true);
    return;
  }
  if (cropSelection || cropModelResult || cropAnnotVisible) {
    cropSelection = null;
    cropModelResult = null;
    cropAnnotVisible = false;
    cropCustomLabels = [];
    cropPreviewOriginal = null;
    cropPreviewClean = null;
    cropPreviewPristine = null;
    cropPreviewAnnotated = false;
    cropPreviewZ = null;
    updateCropAnnotToggle();
    closeCropPanel();
    redrawCropOverlay();
  }
  setCropMode(true);
  setStatus("Görselde sürükleyerek kesilecek bölgeyi seç. [v12]", false);
}

function setCropMode(active) {
  cropModeActive = active;
  if (cropOverlay) {
    cropOverlay.classList.toggle("selecting", active);
  }
  updateCropOverlayVisibility();
  if (cropHint) {
    cropHint.style.display = active ? "block" : "none";
  }
  if (viewer) {
    viewer.setMouseNavEnabled(!active);
  }
  if (cropToggleButton) {
    cropToggleButton.style.background = active
      ? "linear-gradient(135deg,#6ca5ff,#2f7cf6)"
      : "linear-gradient(135deg, rgba(47,124,246,0.22), rgba(108,165,255,0.10))";
    cropToggleButton.style.color = active ? "#04101f" : "#cfe0ff";
    cropToggleButton.style.opacity = "1";
    cropToggleButton.style.cursor = "pointer";
    cropToggleButton.style.borderColor = active ? "transparent" : "rgba(125,162,255,0.4)";
    cropToggleButton.style.boxShadow = active ? "0 8px 24px rgba(47,124,246,0.45)" : "none";
    if (cropToggleLabel) {
      cropToggleLabel.textContent = active ? "Seçimi Bitir" : "Bölge Seç";
    }
  }
  if (!active) {
    cropDrag = null;
    redrawCropOverlay();
  }
}

function bindCropOverlayEvents() {
  if (!cropOverlay) return;
  cropOverlay.addEventListener("mousedown", onCropMouseDown);
  cropOverlay.addEventListener("mousemove", onCropAnnotHover);
  cropOverlay.addEventListener("mouseleave", hideCropAnnotTip);
  cropOverlay.addEventListener("dblclick", onCropAnnotDblClick);
  cropOverlay.addEventListener("wheel", onCropWheel, { passive: false });
  if (viewer?.canvas) {
    viewer.canvas.addEventListener("mousemove", onCropAnnotHover);
    viewer.canvas.addEventListener("mouseleave", hideCropAnnotTip);
    viewer.canvas.addEventListener("dblclick", onCropAnnotDblClick);
  }
}

function onCropWheel(event) {
  if (!viewer || !viewer.viewport) return;
  if (!cropModeActive && !cropSelection) return;
  event.preventDefault();
  event.stopPropagation();
  const or = cropOverlay.getBoundingClientRect();
  const factor = Math.exp(-event.deltaY * 0.0015);
  const px = new OpenSeadragon.Point(event.clientX - or.left, event.clientY - or.top);
  const vp = viewer.viewport.pointFromPixel(px, true);
  viewer.viewport.zoomBy(factor, vp, true);
}

function hideCropAnnotTip() {
  cropAnnotHoverIndex = -1;
  const tip = document.querySelector("#crop-annot-tip");
  if (tip) tip.style.display = "none";
  if (viewer?.canvas && !cropModeActive) viewer.canvas.style.cursor = "";
}

function findCropAnnotAt(event) {
  if (!cropAnnotScreen.length) return -1;
  const rect = cropOverlay.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  for (let i = cropAnnotScreen.length - 1; i >= 0; i--) {
    const b = cropAnnotScreen[i];
    if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return i;
  }
  return -1;
}

function onCropAnnotHover(event) {
  const tip = document.querySelector("#crop-annot-tip");
  if (!tip) return;

  // Çizim modu kapalıyken (seçim tamamlandı) overlay varsayılan olarak tıklamaları
  // geçirir ki harita gezilebilsin. Ama fare tutamaç/kutu üzerine gelince overlay'i
  // "auto" yapıp üste alıyoruz — böylece mousedown OpenSeadragon'a hiç ulaşmadan
  // doğrudan bizim overlay'e düşüyor (yarış durumu yok, pan asla tetiklenmiyor).
  // Aktif bir sürükleme sürerken (resize/move) konumdan bağımsız "auto" kalır.
  if (cropOverlay && !cropModeActive && cropSelection && !cropDrag) {
    const handleHover = cropHandleAt(event.clientX, event.clientY);
    const inSelHover = !handleHover && cropPointInSelection(event.clientX, event.clientY);
    cropOverlay.style.pointerEvents = (handleHover || inSelHover) ? "auto" : "none";
  }

  const overlayActive = cropOverlay && cropOverlay.style.pointerEvents === "auto";
  if (overlayActive || cropSelection) {
    const handle = cropHandleAt(event.clientX, event.clientY);
    let cursor;
    if (handle) {
      cursor = handle.includes("n") || handle.includes("s")
        ? handle.includes("w") || handle.includes("e")
          ? handle === "nw" || handle === "se" ? "nwse-resize" : "nesw-resize"
          : "ns-resize"
        : "ew-resize";
    } else if (cropPointInSelection(event.clientX, event.clientY)) {
      cursor = "move";
    } else {
      // Overlay pasifken (seçim tamamlandı, harita gezilebilir) kutunun dışında
      // varsayılan imleç kalsın — crosshair sadece aktif çizim modunda gösterilir.
      cursor = overlayActive ? "crosshair" : "";
    }
    if (overlayActive) cropOverlay.style.cursor = cursor;
    if (viewer?.canvas) viewer.canvas.style.cursor = cursor;
  }

  if (!cropAnnotVisible || !cropAnnotScreen.length) {
    tip.style.display = "none";
    return;
  }
  const idx = findCropAnnotAt(event);
  if (idx < 0) {
    cropAnnotHoverIndex = -1;
    tip.style.display = "none";
    return;
  }
  const box = cropAnnotScreen[idx];
  cropAnnotHoverIndex = idx;
  tip.style.display = "block";
  tip.style.left = `${box.x + 3}px`;
  tip.style.top = `${box.y + 3}px`;
  tip.style.transform = "none";
  tip.style.maxWidth = "none";
  tip.style.borderColor = box.color ?? "rgba(125,162,255,0.4)";
  tip.innerHTML = `<span style="display:inline-block; width:6px; height:6px; border-radius:2px; background:${box.color ?? "#6ca5ff"}; margin-right:5px; vertical-align:middle;"></span>${escapeHtml(box.name)}`;
}

function onCropAnnotDblClick(event) {
  if (!cropModelResult?.detections?.length) return;
  const idx = findCropAnnotAt(event);
  if (idx >= 0) {
    event.preventDefault();
    event.stopPropagation();
    openCropEditor(idx);
  }
}

const CROP_HANDLE_HIT_PX = 12;
const CROP_MIN_SIZE = 8;

function cropLocalPoint(clientX, clientY) {
  const or = cropOverlay.getBoundingClientRect();
  return { x: clientX - or.left, y: clientY - or.top };
}

function cropHandleAt(clientX, clientY) {
  if (!cropSelection || !cropOverlay) return null;
  const rect = computeCropScreenRect();
  if (!rect) return null;
  const { x, y, w, h } = rect;
  const { x: lx, y: ly } = cropLocalPoint(clientX, clientY);
  const handles = {
    nw: [x, y], ne: [x + w, y], sw: [x, y + h], se: [x + w, y + h],
    n: [x + w / 2, y], s: [x + w / 2, y + h], w: [x, y + h / 2], e: [x + w, y + h / 2],
  };
  for (const [name, [hx, hy]] of Object.entries(handles)) {
    if (Math.hypot(lx - hx, ly - hy) <= CROP_HANDLE_HIT_PX) return name;
  }
  return null;
}

function cropPointInSelection(clientX, clientY) {
  if (!cropSelection || !cropOverlay) return false;
  const rect = computeCropScreenRect();
  if (!rect) return false;
  const { x: lx, y: ly } = cropLocalPoint(clientX, clientY);
  return lx >= rect.x && lx <= rect.x + rect.w && ly >= rect.y && ly <= rect.y + rect.h;
}

function onCropCanvasClick(event) {
  // Panel kapalıyken mavi seçim alanına tıklanınca pencere yeniden açılır
  if (cropModeActive || cropPanelOpen || !cropSelection) return;
  if (!cropPointInSelection(event.clientX, event.clientY)) return;
  showCropPanel();
}

// Tutamaç veya kutu içine tıklandıysa resize/move sürüklemesini başlatır. Hem overlay
// hem de (overlay pasifken) viewer canvas'ından çağrılır. Başlatılırsa true döner.
function tryStartCropAdjustDrag(event) {
  if (!cropSelection) return false;
  const point = screenToImage(event.clientX, event.clientY);
  const handle = cropHandleAt(event.clientX, event.clientY);
  if (handle) {
    cropDrag = {
      mode: "resize",
      handle,
      ox: cropSelection.x, oy: cropSelection.y,
      ow: cropSelection.width, oh: cropSelection.height,
      startX: point.x, startY: point.y,
    };
    return true;
  }
  if (cropPointInSelection(event.clientX, event.clientY)) {
    cropDrag = {
      mode: "move",
      ox: cropSelection.x, oy: cropSelection.y,
      ow: cropSelection.width, oh: cropSelection.height,
      startX: point.x, startY: point.y,
    };
    return true;
  }
  return false;
}

function onCropMouseDown(event) {
  if (!cropModeActive && !cropSelection) return;
  if (!viewer || !viewer.world || viewer.world.getItemCount() === 0) return;
  if (event.button !== 0) return;
  event.preventDefault();
  setCropCleanView(true);
  if (!tryStartCropAdjustDrag(event)) {
    const point = screenToImage(event.clientX, event.clientY);
    cropDrag = { mode: "draw", ax: point.x, ay: point.y, bx: point.x, by: point.y };
  }
  ensureCropRedrawLoop();
  document.addEventListener("mousemove", onCropMouseMove);
  document.addEventListener("mouseup", onCropMouseUp);
}

function onCropMouseMove(event) {
  if (!cropDrag) return;
  const point = screenToImage(event.clientX, event.clientY);
  if (cropDrag.mode === "draw") {
    cropDrag.bx = point.x;
    cropDrag.by = point.y;
  } else if (cropDrag.mode === "resize") {
    const { handle, ox, oy, ow, oh } = cropDrag;
    const maxX = currentMetadata?.width ?? Number.MAX_SAFE_INTEGER;
    const maxY = currentMetadata?.height ?? Number.MAX_SAFE_INTEGER;
    const px = Math.max(0, Math.min(point.x, maxX));
    const py = Math.max(0, Math.min(point.y, maxY));
    let nx1 = ox, ny1 = oy, nx2 = ox + ow, ny2 = oy + oh;
    if (handle.includes("w")) nx1 = Math.max(0, Math.min(px, nx2 - CROP_MIN_SIZE));
    if (handle.includes("e")) nx2 = Math.min(maxX, Math.max(px, nx1 + CROP_MIN_SIZE));
    if (handle.includes("n")) ny1 = Math.max(0, Math.min(py, ny2 - CROP_MIN_SIZE));
    if (handle.includes("s")) ny2 = Math.min(maxY, Math.max(py, ny1 + CROP_MIN_SIZE));
    cropSelection = { x: nx1, y: ny1, width: nx2 - nx1, height: ny2 - ny1 };
  } else if (cropDrag.mode === "move") {
    const { ox, oy, ow, oh, startX, startY } = cropDrag;
    const maxX = currentMetadata?.width ?? Number.MAX_SAFE_INTEGER;
    const maxY = currentMetadata?.height ?? Number.MAX_SAFE_INTEGER;
    const dx = point.x - startX;
    const dy = point.y - startY;
    const x = Math.max(0, Math.min(ox + dx, Math.max(0, maxX - ow)));
    const y = Math.max(0, Math.min(oy + dy, Math.max(0, maxY - oh)));
    cropSelection = { x, y, width: ow, height: oh };
  }
  redrawCropOverlay();
}

function onCropMouseUp() {
  document.removeEventListener("mousemove", onCropMouseMove);
  document.removeEventListener("mouseup", onCropMouseUp);
  setCropCleanView(false);
  if (!cropDrag) return;
  const drag = cropDrag;
  cropDrag = null;

  if (drag.mode !== "draw") {
    const sel = cropSelection;
    if (sel) {
      sel.x = Math.round(sel.x);
      sel.y = Math.round(sel.y);
      sel.width = Math.round(sel.width);
      sel.height = Math.round(sel.height);
      setStatus(`Bölge güncellendi: ${Math.round(sel.width)} × ${Math.round(sel.height)} px`, false);
      redrawCropOverlay();
      if (cropPanelOpen) {
        const detailsBody = document.querySelector("#crop-details-body");
        const detailsOpen = detailsBody?.style.display === "block";
        renderCropPanel();
        if (detailsOpen) {
          const body = document.querySelector("#crop-details-body");
          const chevron = document.querySelector("#crop-details-chevron");
          const label = document.querySelector("#crop-details-label");
          if (body) body.style.display = "block";
          if (chevron) chevron.style.transform = "rotate(180deg)";
          if (label) label.textContent = "Detayları Gizle";
        }
        renderCropPreview();
        updateCropJsonView();
      } else {
        // Panel kapalıyken kutuya (veya tutamacına) tıklanınca/sürüklenince pencere
        // yeniden açılsın — kapatılan pencereye geri dönmenin tek yolu bu olmasın diye.
        showCropPanel();
      }
      // Fare hâlâ kutu/tutamaç üzerinde olduğu için overlay'i açık bırak; uzaklaşınca
      // bir sonraki mousemove haritayı zaten serbest bırakacak.
      if (cropOverlay && !cropModeActive) cropOverlay.style.pointerEvents = "auto";
      archiveCropEvent(drag.mode === "resize" ? "region_resized" : "region_moved");
    }
    return;
  }

  const { ax, ay, bx, by } = drag;

  const maxX = currentMetadata?.width ?? Number.MAX_SAFE_INTEGER;
  const maxY = currentMetadata?.height ?? Number.MAX_SAFE_INTEGER;
  const x = Math.min(Math.max(0, Math.min(ax, bx)), maxX - 1);
  const y = Math.min(Math.max(0, Math.min(ay, by)), maxY - 1);
  const width = Math.min(Math.abs(bx - ax), maxX - x);
  const height = Math.min(Math.abs(by - ay), maxY - y);

  if (width < CROP_MIN_SIZE || height < CROP_MIN_SIZE) {
    redrawCropOverlay();
    return;
  }

  cropSelection = { x, y, width, height };
  cropModelResult = null;
  cropAnnotVisible = false;
  cropCustomLabels = [];
  cropPreviewOriginal = null;
  cropPreviewClean = null;
  cropPreviewPristine = null;
  cropPreviewAnnotated = false;
  cropPreviewZ = null;
  updateCropAnnotToggle();
  setCropMode(false);
  showCropPanel();
  // setCropMode(false) overlay'i "none"a çevirir; fare az önce burada yeni kutuyu
  // çizdiği için hemen tekrar tutulabilsin diye açık bırakıyoruz.
  if (cropOverlay) cropOverlay.style.pointerEvents = "auto";
  setStatus(`Bölge seçildi: ${Math.round(width)} × ${Math.round(height)} px — tutamaçlardan ayarla.`, false);
  archiveCropEvent("region_selected");
}

function screenToImage(clientX, clientY) {
  const rect = cropOverlay.getBoundingClientRect();
  const viewportPoint = viewer.viewport.pointFromPixel(
    new OpenSeadragon.Point(clientX - rect.left, clientY - rect.top),
    true
  );
  const tiledImage = viewer.world.getItemAt(0);
  return tiledImage.viewportToImageCoordinates(viewportPoint);
}

function imageToScreen(x, y) {
  const tiledImage = viewer.world.getItemAt(0);
  const viewportPoint = tiledImage.imageToViewportCoordinates(new OpenSeadragon.Point(x, y));
  const pixel = viewer.viewport.viewportToViewerElementCoordinates(viewportPoint);
  return { x: pixel.x, y: pixel.y };
}


function computeCropScreenRect() {
  if (!viewer || !viewer.world || viewer.world.getItemCount() === 0) return null;
  let x0, y0, x1, y1;
  if (cropDrag && cropDrag.mode === "draw") {
    x0 = cropDrag.ax; y0 = cropDrag.ay; x1 = cropDrag.bx; y1 = cropDrag.by;
  } else if (cropSelection) {
    x0 = cropSelection.x; y0 = cropSelection.y;
    x1 = cropSelection.x + cropSelection.width;
    y1 = cropSelection.y + cropSelection.height;
  } else {
    return null;
  }
  const a = imageToScreen(x0, y0);
  const b = imageToScreen(x1, y1);
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
}

function drawCropRect(ctx, rect) {
  const { x, y, w, h } = rect;
  ctx.save();

  // Kutular gizliyken alanın mavi dolgusu kaldırılır (şablon köşeleri/kenarlığı durur)
  const hideFill = cropModelResult?.detections?.length && !cropAnnotVisible;
  if (!hideFill) {
    ctx.fillStyle = "rgba(47,124,246,0.14)";
    ctx.fillRect(x, y, w, h);
  }

  const gradient = ctx.createLinearGradient(x, y, x + w, y + h);
  gradient.addColorStop(0, "#6ca5ff");
  gradient.addColorStop(1, "#a8f0ff");
  ctx.strokeStyle = gradient;
  ctx.lineWidth = 2;
  ctx.setLineDash([7, 5]);
  ctx.shadowColor = "rgba(108,165,255,0.85)";
  ctx.shadowBlur = 12;
  ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
  ctx.setLineDash([]);
  ctx.shadowBlur = 0;

  ctx.fillStyle = "#cfe0ff";
  for (const [hx, hy] of [[x, y], [x + w, y], [x, y + h], [x + w, y + h]]) {
    ctx.beginPath();
    ctx.arc(hx, hy, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#2f7cf6";
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  ctx.fillStyle = "rgba(207,224,255,0.85)";
  for (const [hx, hy] of [[x + w / 2, y], [x + w / 2, y + h], [x, y + h / 2], [x + w, y + h / 2]]) {
    ctx.beginPath();
    ctx.arc(hx, hy, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#2f7cf6";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
  ctx.restore();

  if (cropSelection && !cropDrag) {
    const text = `${Math.round(cropSelection.width)} × ${Math.round(cropSelection.height)} px`;
    ctx.save();
    ctx.font = "600 12px 'SF Pro Display','Segoe UI',sans-serif";
    const textWidth = ctx.measureText(text).width;
    const boxX = x + 6;
    const boxY = (y - 8) < 16 ? y + 18 : y - 8;
    ctx.fillStyle = "rgba(6,12,26,0.85)";
    if (typeof ctx.roundRect === "function") {
      ctx.beginPath();
      ctx.roundRect(boxX - 5, boxY - 12, textWidth + 10, 18, 6);
      ctx.fill();
    } else {
      ctx.fillRect(boxX - 5, boxY - 12, textWidth + 10, 18);
    }
    ctx.fillStyle = "#cfe0ff";
    ctx.textBaseline = "middle";
    ctx.fillText(text, boxX, boxY - 3);
    ctx.restore();
  }
}

function redrawCropOverlay() {
  if (!viewer || !viewer.world || !cropOverlay || !cropCanvas || !cropCtx) return;
  const dpr = window.devicePixelRatio || 1;
  const cssWidth = cropOverlay.clientWidth;
  const cssHeight = cropOverlay.clientHeight;
  if (cssWidth === 0 || cssHeight === 0) return;

  const targetWidth = Math.round(cssWidth * dpr);
  const targetHeight = Math.round(cssHeight * dpr);
  if (cropCanvas.width !== targetWidth || cropCanvas.height !== targetHeight) {
    cropCanvas.width = targetWidth;
    cropCanvas.height = targetHeight;
  }

  cropCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  cropCtx.clearRect(0, 0, cssWidth, cssHeight);

  const rect = computeCropScreenRect();
  if (rect) {
    drawCropRect(cropCtx, rect);
  }

  // YOLO kutu çizimi (etiket kutunun üstünde tam adıyla; hover'da da tooltip)
  cropAnnotScreen = [];
  if (cropAnnotVisible && cropModelResult?.detections?.length && cropModelResult._slideRegion) {
    const reg = cropModelResult._slideRegion;
    const sx = reg.w / reg.imgW;
    const sy = reg.h / reg.imgH;
    for (const det of cropModelResult.detections) {
      const [bx1, by1, bx2, by2] = det.bbox;
      const a = imageToScreen(reg.x + bx1 * sx, reg.y + by1 * sy);
      const b = imageToScreen(reg.x + bx2 * sx, reg.y + by2 * sy);
      const x = Math.min(a.x, b.x);
      const y = Math.min(a.y, b.y);
      const w = Math.abs(b.x - a.x);
      const h = Math.abs(b.y - a.y);
      if (w < 0.5 || h < 0.5) continue;
      const color = cropAnnotColor(det.class_name);
      cropCtx.save();
      cropCtx.strokeStyle = color;
      cropCtx.lineWidth = 2;
      cropCtx.shadowColor = color;
      cropCtx.shadowBlur = 10;
      cropCtx.strokeRect(x + 1, y + 1, w - 2, h - 2);
      cropCtx.restore();
      cropAnnotScreen.push({ x, y, w, h, name: det.class_name, color });
    }
  }

  // Otomatik etiketleme kutuları — bilerek crop kutularıyla BİREBİR aynı çizim
  // hattını kullanıyor. Ayrı bir canvas + kendi animasyon döngüsü denendiğinde
  // kutular ekranda donup dokunun altlarından kaymasına yol açıyordu; burada
  // OpenSeadragon'ın kendi "animation" olaylarıyla senkron çizildikleri için
  // her karede dokuyla birlikte hareket ederler.
  if ((autoLabelVisible || autoLabelBusy) && autoLabelDetections.length) {
    const tiledImage = viewer.world.getItemAt(0);
    if (tiledImage) {
      // Performans için yalnızca görünür alandaki (biraz taşkınlı) kutuları çiz.
      const imageBounds = tiledImage.viewportToImageRectangle(viewer.viewport.getBounds(true));
      const marginX = imageBounds.width * 0.15;
      const marginY = imageBounds.height * 0.15;
      const vx0 = imageBounds.x - marginX;
      const vy0 = imageBounds.y - marginY;
      const vx1 = imageBounds.x + imageBounds.width + marginX;
      const vy1 = imageBounds.y + imageBounds.height + marginY;

      for (const det of autoLabelDetections) {
        const [bx1, by1, bx2, by2] = det.bbox;
        if (bx2 < vx0 || bx1 > vx1 || by2 < vy0 || by1 > vy1) continue;
        const a = imageToScreen(bx1, by1);
        const b = imageToScreen(bx2, by2);
        const x = Math.min(a.x, b.x);
        const y = Math.min(a.y, b.y);
        const w = Math.abs(b.x - a.x);
        const h = Math.abs(b.y - a.y);
        if (w < 2 || h < 2) continue;
        const color = cropAnnotColor(det.class_name);
        cropCtx.strokeStyle = color;
        cropCtx.lineWidth = 1.5;
        cropCtx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
        if (w > 46 && h > 18) {
          cropCtx.font = "600 10px system-ui, sans-serif";
          cropCtx.fillStyle = color;
          cropCtx.fillText(det.class_name, x + 2, Math.max(10, y - 2));
        }
      }
    }
  }

  // Hover edilen kutu varsa etiketi kutu içinde takip ettir (pan/zoom sırasında)
  const tip = document.querySelector("#crop-annot-tip");
  if (tip && tip.style.display === "block" && cropAnnotHoverIndex >= 0) {
    const hovered = cropAnnotScreen[cropAnnotHoverIndex];
    if (hovered) {
      tip.style.left = `${hovered.x + 3}px`;
      tip.style.top = `${hovered.y + 3}px`;
      tip.style.maxWidth = "none";
    } else {
      hideCropAnnotTip();
    }
  }
}

function ensureCropRedrawLoop() {
  if (cropRafId != null) return;
  const loop = () => {
    cropRafId = null;
    const hasAutoLabels = (autoLabelVisible || autoLabelBusy) && autoLabelDetections.length > 0;
    if (!cropSelection && !cropDrag && !hasAutoLabels && !(cropAnnotVisible && cropModelResult?.detections?.length)) return;
    redrawCropOverlay();
    // Sürekli yeniden çizim yalnızca sürükleme/çizim sırasında gerekli.
    // Pan/zoom sırasında OpenSeadragon'ın animation/resize olayları yeniden çizer.
    if (cropDrag) cropRafId = requestAnimationFrame(loop);
  };
  cropRafId = requestAnimationFrame(loop);
}

function cancelCropRedrawLoop() {
  if (cropRafId != null) {
    cancelAnimationFrame(cropRafId);
    cropRafId = null;
  }
}

function layoutCropPanelSlot() {
  if (!cropPanelSlot) return;
  const panel = cropPanelSlot.querySelector(".crop-panel-enter");
  const mode = PANEL_STAGE_SIZES[cropPanelStage] ?? PANEL_STAGE_SIZES[0];
  const w = typeof mode.w === "function" ? mode.w() : mode.w;
  const h = typeof mode.h === "function" ? mode.h() : mode.h;
  cropPanelSlot.style.position = "fixed";
  cropPanelSlot.style.margin = "0";
  cropPanelSlot.style.maxWidth = "none";
  cropPanelSlot.style.maxHeight = "none";
  cropPanelSlot.style.width = `${w}px`;
  cropPanelSlot.style.height = `${h}px`;
  if (cropPanelStage === 0) {
    const prev = cropPanelPrevState ?? {};
    cropPanelSlot.style.left = `${prev.left ?? 8}px`;
    cropPanelSlot.style.top = `${prev.top ?? 8}px`;
    cropPanelSlot.style.bottom = "auto";
    cropPanelSlot.style.zIndex = "32";
  } else {
    cropPanelSlot.style.left = "8px";
    cropPanelSlot.style.top = "8px";
    cropPanelSlot.style.bottom = "auto";
    cropPanelSlot.style.zIndex = "100";
  }
  if (panel) {
    panel.style.width = "100%";
    panel.style.height = "100%";
    panel.style.maxHeight = "none";
    panel.style.maxWidth = "none";
    panel.style.zoom = "";
    panel.classList.toggle("crop-panel--full", cropPanelStage === 1);
    panel.classList.toggle("crop-panel--narrow", window.innerWidth < 680);
  }
}

function showCropPanel() {
  if (!cropPanelSlot || !cropSelection) return;
  cropPanelOpen = true;
  ensureCropRedrawLoop();
  updateCropClearButton();
  renderCropPanel();
  layoutCropPanelSlot();
  renderCropPreview();
}

function renderCropPanel() {
  const sel = cropSelection;
  const physical = currentMetadata?.physicalScale;
  const mppx = physical?.available ? physical.micronsPerPixelX : null;
  const widthMicrons = mppx ? sel.width * mppx : null;
  const heightMicrons = mppx ? sel.height * mppx : null;
  const meta = currentMetadata ?? {};
  const centerX = Math.round(sel.x + sel.width / 2);
  const centerY = Math.round(sel.y + sel.height / 2);
  const entry = getSelectedEntry();
  const slidePx = meta.width && meta.height ? meta.width * meta.height : 0;
  const pct = slidePx ? ((sel.width * sel.height) / slidePx) * 100 : null;

  cropPanelSlot.innerHTML = `
    <div class="crop-panel-enter" style="position:relative; width:100%; height:100%; max-height:none; max-width:none; display:flex; flex-direction:column; background:rgba(9,14,28,0.92); backdrop-filter:blur(20px); border:1px solid rgba(125,162,255,0.26); border-radius:22px; box-shadow:0 30px 90px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.06); color:#f5f7fa; overflow:hidden;">
      <div style="flex:none; height:3px; background:linear-gradient(90deg,#2f7cf6,#6ca5ff,#4ade80);"></div>
      <div id="crop-panel-header" title="Sürükleyerek taşı" style="flex:none; display:flex; align-items:center; justify-content:space-between; padding:14px 16px; cursor:grab; user-select:none; background:linear-gradient(135deg, rgba(47,124,246,0.18), rgba(108,165,255,0.06)); border-bottom:1px solid rgba(125,162,255,0.16);">
        <div style="display:flex; align-items:center; gap:10px;">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" style="color:#7da2ff; flex:none;">
            <circle cx="5" cy="5" r="1.6"/><circle cx="12" cy="5" r="1.6"/><circle cx="19" cy="5" r="1.6"/>
            <circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>
            <circle cx="5" cy="19" r="1.6"/><circle cx="12" cy="19" r="1.6"/><circle cx="19" cy="19" r="1.6"/>
          </svg>
          <div>
            <div style="font-size:0.68rem; letter-spacing:0.18em; color:#7da2ff; text-transform:uppercase;">Crop / Bölge Analizi</div>
            <div style="font-weight:800; font-size:1rem; margin-top:2px;">Kesim Bölgesi</div>
          </div>
        </div>
        <div style="display:flex; gap:6px; flex:none;">
          <button id="crop-minimize-button" type="button" class="tip-btn" data-tip="${cropPanelMinimized ? "Genişlet" : "Küçült"}" title="${cropPanelMinimized ? "Genişlet" : "Küçült"}">
            <svg id="crop-minimize-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${cropPanelMinimized ? '<path d="M6 9l6 6 6-6"/>' : '<path d="M6 15l6-6 6 6"/>'}</svg>
          </button>
          <button id="crop-maximize-button" type="button" class="tip-btn" data-tip="Genişlet" title="Genişlet">
            <svg id="crop-maximize-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/></svg>
          </button>
          <button id="crop-panel-close" type="button" class="tip-btn danger" data-tip="Kapat" title="Kapat">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>
          </button>
        </div>
      </div>
      <div id="crop-panel-body" class="crop-panel-scroll" style="flex:1; min-height:0; overflow-y:auto; padding:16px; ${cropPanelMinimized ? "display:none;" : ""}">
        <div style="font-size:0.82rem; color:rgba(245,247,250,0.78); margin-bottom:10px; word-break:break-all;">${escapeHtml(entry?.slide?.fileName ?? "—")}</div>
        <div class="crop-cols">
        <div class="crop-preview-wrap" style="position:relative; border-radius:16px; overflow:hidden; background:#05070d; border:1px solid rgba(125,162,255,0.18);">
          <canvas id="crop-preview-canvas" title="Büyük görüntüle" style="display:block; cursor:zoom-in;"></canvas>
          <div id="crop-preview-loading" style="position:absolute; inset:0; display:grid; place-items:center; background:rgba(5,7,13,0.55); color:#9fbeff; font-size:0.85rem;">Bölge yükleniyor...</div>
          <div id="crop-preview-error" style="position:absolute; inset:0; display:none; place-items:center; background:rgba(5,7,13,0.88); color:#ff6b6b; font-size:0.82rem; text-align:center; padding:14px; border:2px solid rgba(255,90,90,0.55); border-radius:12px;">
            <div>
              <div style="margin-bottom:8px; font-weight:800; font-size:0.95rem; letter-spacing:0.03em;">ÖNİZLEME YÜKLENEMEDİ</div>
              <div id="crop-preview-error-msg" style="font-size:0.72rem; color:#ffd7d7; word-break:break-all; margin-bottom:10px;"></div>
              <button id="crop-preview-retry" type="button" style="padding:8px 16px; border-radius:999px; border:1px solid rgba(255,180,180,0.4); background:rgba(255,180,180,0.12); color:#ffb4b4; cursor:pointer; font-weight:700;">Yeniden Dene</button>
            </div>
          </div>
          <div style="position:absolute; top:8px; right:8px; z-index:6; display:flex; align-items:center; gap:8px;">
            <span id="crop-model-badge" style="display:none; padding:4px 10px; border-radius:999px; background:rgba(74,222,128,0.16); border:1px solid rgba(74,222,128,0.4); color:#7fe3a3; font-weight:800; font-size:0.78rem;"></span>
            <button id="crop-robot-button" type="button" title="Model ile hücreleri etiketle" data-tip="Model ile etiketle" style="width:42px; height:42px; border-radius:50%; border:1px solid rgba(125,162,255,0.5); background:linear-gradient(135deg,#2f7cf6,#6ca5ff); color:#04101f; cursor:pointer; display:grid; place-items:center; box-shadow:0 8px 24px rgba(47,124,246,0.45); transition:160ms ease; flex:none; position:relative;">
              <svg id="crop-robot-icon" width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <rect x="5" y="8" width="14" height="10" rx="3"/>
                <circle cx="9.5" cy="13" r="1.4" fill="currentColor" stroke="none"/>
                <circle cx="14.5" cy="13" r="1.4" fill="currentColor" stroke="none"/>
                <path d="M12 8V5"/>
                <circle cx="12" cy="4" r="1.2" fill="currentColor" stroke="none"/>
                <path d="M8 18.5v1.8M16 18.5v1.8"/>
              </svg>
            </button>
          </div>
        </div>
        <div class="crop-side">
        <div style="margin-top:12px;">
          <button id="crop-details-toggle" type="button" style="width:100%; display:flex; align-items:center; justify-content:center; gap:8px; padding:9px 12px; border-radius:999px; border:1px solid rgba(125,162,255,0.3); background:linear-gradient(135deg, rgba(47,124,246,0.14), rgba(108,165,255,0.06)); color:#9fbeff; cursor:pointer; font-size:0.82rem; font-weight:700; letter-spacing:0.04em; transition:160ms ease;">
            <svg id="crop-details-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" style="transition:160ms ease;"><path d="M6 9l6 6 6-6"/></svg>
            <span id="crop-details-label">Bölge Detayları</span>
          </button>
          <div id="crop-details-body" style="display:none; margin-top:10px;">
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
              <div style="padding:10px; border-radius:14px; background:rgba(255,255,255,0.05);">
                <div style="font-size:0.68rem; color:rgba(245,247,250,0.5); margin-bottom:3px;">Piksel</div>
                <div style="font-weight:700; font-size:0.92rem;">${Math.round(sel.width)} × ${Math.round(sel.height)}</div>
              </div>
              <div style="padding:10px; border-radius:14px; background:rgba(255,255,255,0.05);">
                <div style="font-size:0.68rem; color:rgba(245,247,250,0.5); margin-bottom:3px;">Fiziksel</div>
                <div style="font-weight:700; font-size:0.92rem;">${widthMicrons ? `${fmtMicron(widthMicrons)} × ${fmtMicron(heightMicrons)}` : "—"}</div>
              </div>
              <div style="padding:10px; border-radius:14px; background:rgba(255,255,255,0.05);">
                <div style="font-size:0.68rem; color:rgba(245,247,250,0.5); margin-bottom:3px;">Başlangıç (x, y)</div>
                <div style="font-weight:700; font-size:0.92rem;">${Math.round(sel.x)}, ${Math.round(sel.y)}</div>
              </div>
              <div style="padding:10px; border-radius:14px; background:rgba(255,255,255,0.05);">
                <div style="font-size:0.68rem; color:rgba(245,247,250,0.5); margin-bottom:3px;">Merkez (cx, cy)</div>
                <div style="font-weight:700; font-size:0.92rem;">${centerX}, ${centerY}</div>
              </div>
              <div style="padding:10px; border-radius:14px; background:rgba(255,255,255,0.05);">
                <div style="font-size:0.68rem; color:rgba(245,247,250,0.5); margin-bottom:3px;">Ölçek</div>
                <div style="font-weight:700; font-size:0.92rem;">${mppx ? `${mppx} µm/px` : "—"}</div>
              </div>
              <div style="padding:10px; border-radius:14px; background:rgba(255,255,255,0.05);">
                <div style="font-size:0.68rem; color:rgba(245,247,250,0.5); margin-bottom:3px;">Önizleme seviyesi</div>
                <div style="font-weight:700; font-size:0.92rem;">${cropPreviewZ ?? "…"} / ${(meta.levels?.length ?? 1) - 1}</div>
              </div>
            </div>
            <div style="margin-top:8px; display:grid; gap:6px; padding:10px 12px; border-radius:14px; background:rgba(255,255,255,0.05); font-size:0.82rem; color:rgba(245,247,250,0.68);">
              <div>Slayt boyutu: <span style="color:#9fbeff;">${meta.width ?? "—"} × ${meta.height ?? "—"} px</span></div>
              <div style="display:flex; justify-content:space-between;">
                <span>Tile: <b style="color:#9fbeff;">${meta.tileSize ?? "—"} px</b></span>
                <span>Seviye: <b style="color:#9fbeff;">${(meta.levels?.length ?? 0)}</b></span>
              </div>
              <div style="display:flex; justify-content:space-between;">
                <span>Birleştirilen tile: <b style="color:#9fbeff;">${cropPreviewTileCount || "…"}</b></span>
                <span>Slide'in <b style="color:#9fbeff;">%${pct !== null ? pct.toFixed(4) : "…"}</b>'i</span>
              </div>
            </div>
          </div>
        </div>
        <div id="crop-results" style="display:none; margin-top:12px;"></div>
        <div style="margin-top:14px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
            <span style="font-size:0.85rem; color:#cfe0ff; font-weight:600;">Threshold</span>
            <div style="display:flex; align-items:center; gap:8px;">
              <span id="crop-threshold-value" style="font-size:0.9rem; font-weight:800; color:#ffd29d;">${cropThresholdValue}</span>
              <button id="crop-threshold-reset" type="button" data-tip="Sıfırla (128)" title="Threshold'u sıfırla (128)" style="display:grid; place-items:center; width:24px; height:24px; border-radius:50%; border:1px solid rgba(255,210,157,0.35); background:rgba(255,210,157,0.1); color:#ffd29d; cursor:pointer; transition:160ms ease; flex:none; position:relative;">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 2.64-6.36L3 8"/><path d="M3 3v5h5"/></svg>
              </button>
            </div>
          </div>
          <input id="crop-threshold-input" class="crop-range" type="range" min="0" max="255" step="1" value="${cropThresholdValue}" />
        </div>
        <div style="display:flex; justify-content:space-between; align-items:center; margin-top:12px;">
          <span style="font-size:0.85rem; color:#cfe0ff; font-weight:600;">Maske önizleme</span>
          <label class="crop-switch">
            <input id="crop-mask-toggle" type="checkbox" ${cropMaskEnabled ? "checked" : ""} />
            <span class="slider"></span>
          </label>
        </div>
        <div class="crop-bottom" style="margin-top:14px;">
        <div style="display:flex; gap:6px;">
          <button id="crop-json-toggle" class="crop-btn ghost" type="button" style="flex:1;">JSON'u Göster</button>
          <button id="crop-copy-button" class="crop-btn ghost" type="button" style="flex:1;">JSON Kopyala</button>
        </div>
        <div style="padding:12px; border-radius:14px; background:rgba(0,0,0,0.3); border:1px solid rgba(125,162,255,0.14); margin-top:10px; display:none;">
          <div class="crop-json" id="crop-json-view">${escapeHtml(JSON.stringify(buildCropJson(), null, 2))}</div>
        </div>
        <button id="crop-download-button" class="crop-btn download" type="button" style="width:100%; margin-top:8px;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" style="flex:none;">
            <path d="M12 3v12"/><path d="M7 11l5 5 5-5"/><path d="M4 21h16"/>
          </svg>
          <span>Normal İndir (+ JSON)</span>
        </button>
        <button id="crop-download-annot-button" class="crop-btn download" type="button" style="width:100%; margin-top:8px;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="flex:none;">
            <rect x="3" y="3" width="18" height="18" rx="2"/><path d="M12 8v8M8 12h8"/>
          </svg>
          <span>Annotation'lu İndir</span>
        </button>
        <button id="crop-clear-button" class="crop-btn danger" type="button" style="width:100%; margin-top:8px;">Seçimi Temizle</button>
        <div id="crop-status" style="margin-top:10px; font-size:0.8rem; color:rgba(245,247,250,0.6); min-height:1em;"></div>
        </div>
        </div>
      </div>
      <div id="crop-resize-handle" title="Sürükleyerek boyutlandır" style="position:absolute; right:3px; bottom:3px; z-index:5; width:18px; height:18px; display:${cropPanelMinimized ? "none" : "grid"}; place-items:center; cursor:nwse-resize; touch-action:none;">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="rgba(125,162,255,0.75)" stroke-width="2.2" stroke-linecap="round"><path d="M18 21l3-3"/><path d="M12 21l9-9"/><path d="M6 21l15-15"/></svg>
      </div>
    </div>
  `;
  cropPreviewCanvas = document.querySelector("#crop-preview-canvas");
  wireCropPanelEvents();
  applyCropPanelMinimizedState();
}

function applyCropPanelMinimizedState() {
  if (!cropPanelSlot) return;
  const panel = cropPanelSlot.querySelector(".crop-panel-enter");
  if (!cropPanelMinimized) return;
  // Küçültülmüşken pencere yalnızca başlık çubuğu kadar yer kaplasın.
  cropPanelSlot.style.height = "auto";
  if (panel) panel.style.height = "auto";
}

function toggleCropPanelMinimized() {
  cropPanelMinimized = !cropPanelMinimized;
  if (cropPanelMinimized) {
    applyCropPanelMinimizedState();
  } else {
    layoutCropPanelSlot();
  }
  const body = document.querySelector("#crop-panel-body");
  if (body) body.style.display = cropPanelMinimized ? "none" : "";
  const resizeHandle = document.querySelector("#crop-resize-handle");
  if (resizeHandle) resizeHandle.style.display = cropPanelMinimized ? "none" : "grid";
  const icon = document.querySelector("#crop-minimize-icon");
  const btn = document.querySelector("#crop-minimize-button");
  if (icon) icon.innerHTML = cropPanelMinimized ? '<path d="M6 9l6 6 6-6"/>' : '<path d="M6 15l6-6 6 6"/>';
  if (btn) {
    const label = cropPanelMinimized ? "Genişlet" : "Küçült";
    btn.title = label;
    btn.setAttribute("data-tip", label);
  }
}

function wireCropPanelEvents() {
  document.querySelector("#crop-panel-close")?.addEventListener("click", () => closeCropPanel());
  document.querySelector("#crop-minimize-button")?.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleCropPanelMinimized();
  });

  const previewCanvas = document.querySelector("#crop-preview-canvas");
  previewCanvas?.addEventListener("click", () => openCropLightbox());

  document.querySelector("#crop-preview-retry")?.addEventListener("click", () => renderCropPreview());

  document.querySelector("#crop-robot-button")?.addEventListener("click", onCropModelClick);

  const detailsToggle = document.querySelector("#crop-details-toggle");
  const detailsBody = document.querySelector("#crop-details-body");
  const detailsChevron = document.querySelector("#crop-details-chevron");
  const detailsLabel = document.querySelector("#crop-details-label");
  detailsToggle?.addEventListener("click", () => {
    if (!detailsBody) return;
    const open = detailsBody.style.display !== "block";
    detailsBody.style.display = open ? "block" : "none";
    if (detailsChevron) detailsChevron.style.transform = open ? "rotate(180deg)" : "none";
    if (detailsLabel) detailsLabel.textContent = open ? "Detayları Gizle" : "Bölge Detayları";
  });

  const maximizeButton = document.querySelector("#crop-maximize-button");
  const maximizeIcon = document.querySelector("#crop-maximize-icon");
  const stageIcons = [
    '<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>',
    '<path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/>',
  ];
  const stageTitles = ["Tam ekran", "Küçült"];
  const applyStageIcon = () => {
    const label = stageTitles[cropPanelStage] ?? stageTitles[0];
    if (maximizeIcon) maximizeIcon.innerHTML = stageIcons[cropPanelStage] ?? stageIcons[0];
    if (maximizeButton) {
      maximizeButton.title = label;
      maximizeButton.setAttribute("data-tip", label);
    }
  };
  maximizeButton?.addEventListener("click", () => {
    if (cropPanelMinimized) toggleCropPanelMinimized();
    if (cropPanelStage === 0) {
      const rect = cropPanelSlot.getBoundingClientRect();
      cropPanelPrevState = { left: rect.left, top: rect.top };
      cropPanelStage = 1;
    } else {
      cropPanelStage = 0;
    }
    layoutCropPanelSlot();
    applyStageIcon();
  });

  const resizeHandle = document.querySelector("#crop-resize-handle");
  resizeHandle?.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (cropPanelStage !== 0) return;
    const rect = cropPanelSlot.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const startW = rect.width;
    const startH = rect.height;
    const onMove = (ev) => {
      const w = Math.min(Math.max(340, startW + (ev.clientX - startX)), Math.max(340, window.innerWidth - rect.left - 8));
      const h = Math.min(Math.max(300, startH + (ev.clientY - startY)), Math.max(300, rect.top + rect.height - 8));
      cropPanelSlot.style.width = `${w}px`;
      cropPanelSlot.style.height = `${h}px`;
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  });

  const dragHeader = document.querySelector("#crop-panel-header");
  if (dragHeader) {
    dragHeader.addEventListener("pointerdown", (event) => {
      if (event.target.closest("button")) return;
      event.preventDefault();
      const startX = event.clientX;
      const startY = event.clientY;
      const rect = cropPanelSlot.getBoundingClientRect();
      const startLeft = rect.left;
      const startTop = rect.top;
      const panel = dragHeader.closest(".crop-panel-enter");
      const panelW = rect.width;
      const panelH = rect.height;
      const maxLeft = Math.max(8, window.innerWidth - panelW - 8);
      const maxTop = Math.max(8, window.innerHeight - panelH - 8);
      cropPanelSlot.style.position = "fixed";
      cropPanelSlot.style.left = `${startLeft}px`;
      cropPanelSlot.style.top = `${startTop}px`;
      cropPanelSlot.style.bottom = "auto";
      cropPanelSlot.style.margin = "0";
      dragHeader.style.cursor = "grabbing";
      const onMove = (ev) => {
        const nx = Math.min(Math.max(8, startLeft + (ev.clientX - startX)), maxLeft);
        const ny = Math.min(Math.max(8, startTop + (ev.clientY - startY)), maxTop);
        cropPanelSlot.style.left = `${nx}px`;
        cropPanelSlot.style.top = `${ny}px`;
      };
      const onUp = () => {
        dragHeader.style.cursor = "grab";
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    });
  }

  const thresholdInput = document.querySelector("#crop-threshold-input");
  thresholdInput?.addEventListener("input", () => {
    cropThresholdValue = Number(thresholdInput.value);
    if (!cropMaskEnabled) {
      cropMaskEnabled = true;
      const maskToggle = document.querySelector("#crop-mask-toggle");
      if (maskToggle) maskToggle.checked = true;
    }
    const label = document.querySelector("#crop-threshold-value");
    if (label) label.textContent = cropThresholdValue;
    applyCropPreviewFx();
    updateCropJsonView();
  });

  const maskToggle = document.querySelector("#crop-mask-toggle");
  maskToggle?.addEventListener("change", () => {
    cropMaskEnabled = maskToggle.checked;
    applyCropPreviewFx();
    updateCropJsonView();
  });

  document.querySelector("#crop-threshold-reset")?.addEventListener("click", () => {
    cropThresholdValue = 128;
    const input = document.querySelector("#crop-threshold-input");
    const label = document.querySelector("#crop-threshold-value");
    if (input) input.value = cropThresholdValue;
    if (label) label.textContent = cropThresholdValue;
    applyCropPreviewFx();
    updateCropJsonView();
    const status = document.querySelector("#crop-status");
    if (status) status.textContent = "Threshold 128'e sıfırlandı.";
  });

  document.querySelector("#crop-copy-button")?.addEventListener("click", copyCropJson);
  const jsonToggle = document.querySelector("#crop-json-toggle");
  const jsonView = document.querySelector("#crop-json-view");
  if (jsonToggle && jsonView?.parentElement) {
    jsonToggle.addEventListener("click", () => {
      const wrap = jsonView.parentElement;
      const hidden = wrap.style.display === "none";
      wrap.style.display = hidden ? "block" : "none";
      jsonToggle.textContent = hidden ? "JSON'u Gizle" : "JSON'u Göster";
      if (hidden) jsonView.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  }
  document.querySelector("#crop-download-button")?.addEventListener("click", () => downloadCropImage(false));
  document.querySelector("#crop-download-annot-button")?.addEventListener("click", () => downloadCropImage(true));
  document.querySelector("#crop-clear-button")?.addEventListener("click", clearCropSelection);
  applyStageIcon();
}

function setCropRobotBusy(busy) {
  const button = document.querySelector("#crop-robot-button");
  const icon = document.querySelector("#crop-robot-icon");
  if (!button || !icon) return;
  button.classList.toggle("busy", busy);
  button.disabled = busy;
  icon.innerHTML = busy
    ? '<circle cx="12" cy="12" r="8" stroke="currentColor" stroke-opacity="0.25" fill="none"/><path d="M12 4a8 8 0 0 1 8 8" stroke="currentColor" fill="none" stroke-linecap="round"/>'
    : '<rect x="5" y="8" width="14" height="10" rx="3"/><circle cx="9.5" cy="13" r="1.4" fill="currentColor" stroke="none"/><circle cx="14.5" cy="13" r="1.4" fill="currentColor" stroke="none"/><path d="M12 8V5"/><circle cx="12" cy="4" r="1.2" fill="currentColor" stroke="none"/><path d="M8 18.5v1.8M16 18.5v1.8"/>';
}

function openCropLightbox() {
  if (!cropPreviewOriginal) return;
  let lightbox = document.getElementById("crop-lightbox");
  if (!lightbox) {
    lightbox = document.createElement("div");
    lightbox.id = "crop-lightbox";
    lightbox.style.cssText = "display:none; position:fixed; inset:0; z-index:500; background:rgba(3,6,14,0.96); backdrop-filter:blur(10px); overflow:hidden; touch-action:none;";
    lightbox.innerHTML = `
      <div style="position:absolute; top:16px; left:20px; right:20px; display:flex; align-items:center; justify-content:space-between; z-index:2;">
        <div style="display:flex; align-items:center; gap:10px;">
          <span style="width:9px; height:9px; border-radius:50%; background:linear-gradient(135deg,#6ca5ff,#4ade80); box-shadow:0 0 14px rgba(108,165,255,0.8);"></span>
          <span style="color:#cfe0ff; font-weight:800; letter-spacing:0.08em;">Bölge Görüntüsü</span>
          <span style="color:#8fa3c8; font-size:12px; letter-spacing:0.05em; margin-left:10px;">Tıkla: yakınlaş · Çift tık: uzaklaş · Tekerlek: zoom · Sürükle: kaydır · ESC: kapat</span>
        </div>
        <div style="display:flex; gap:8px;">
          <button id="crop-lb-download" type="button" class="tip-btn accent" data-tip="Görüntüyü indir" title="Görüntüyü indir">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="M7 11l5 5 5-5"/><path d="M4 21h16"/></svg>
          </button>
          <button id="crop-lb-close" type="button" class="tip-btn danger" data-tip="Kapat" title="Kapat">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>
          </button>
        </div>
      </div>
      <div id="crop-lb-stage" style="position:absolute; inset:0; pointer-events:none;"></div>
      <img id="crop-lb-img" alt="Bölge görüntüsü" style="position:absolute; user-select:none; -webkit-user-drag:none; cursor:zoom-in;"/>
    `;
    document.body.appendChild(lightbox);
    lightbox.addEventListener("click", (e) => {
      if (e.target === lightbox) closeCropLightbox();
    });
    const img = document.querySelector("#crop-lb-img");
    img.addEventListener("load", () => renderCropLb());
    img.addEventListener("click", (e) => {
      e.stopPropagation();
      zoomCropLbAt(1.7, e.clientX, e.clientY);
    });
    img.addEventListener("dblclick", (e) => {
      e.preventDefault();
      e.stopPropagation();
      zoomCropLbAt(1 / 1.7, e.clientX, e.clientY);
    });
    img.addEventListener("wheel", (e) => {
      e.preventDefault();
      e.stopPropagation();
      zoomCropLbAt(Math.exp(-e.deltaY * 0.0018), e.clientX, e.clientY);
    }, { passive: false });
    img.addEventListener("pointerdown", (e) => {
      if (cropLbZoom <= 1) return;
      e.preventDefault();
      e.stopPropagation();
      cropLbDrag = { id: e.pointerId, x: e.clientX, y: e.clientY, ox: cropLbPan.x, oy: cropLbPan.y };
      try { img.setPointerCapture(e.pointerId); } catch { /* boş */ }
      img.style.cursor = "grabbing";
    });
    img.addEventListener("pointermove", (e) => {
      if (!cropLbDrag || cropLbDrag.id !== e.pointerId) return;
      cropLbPan.x = cropLbDrag.ox + (e.clientX - cropLbDrag.x);
      cropLbPan.y = cropLbDrag.oy + (e.clientY - cropLbDrag.y);
      clampCropLbPan();
      renderCropLb();
    });
    const endLbDrag = (e) => {
      if (cropLbDrag && cropLbDrag.id === e.pointerId) {
        cropLbDrag = null;
        img.style.cursor = cropLbZoom > 1 ? "grab" : "zoom-in";
      }
    };
    img.addEventListener("pointerup", endLbDrag);
    img.addEventListener("pointercancel", endLbDrag);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeCropLightbox();
    });
    document.querySelector("#crop-lb-close").addEventListener("click", closeCropLightbox);
    document.querySelector("#crop-lb-download").addEventListener("click", () => {
      const a = document.createElement("a");
      a.href = img.src;
      a.download = `crop_preview_${Date.now()}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    });
  }
  cropLbZoom = 1;
  cropLbPan = { x: 0, y: 0 };
  const img = document.querySelector("#crop-lb-img");
  img.src = cropPreviewOriginal.toDataURL("image/png");
  lightbox.style.display = "block";
  if (img.complete && img.naturalWidth) renderCropLb();
}

function closeCropLightbox() {
  const lightbox = document.getElementById("crop-lightbox");
  if (lightbox) lightbox.style.display = "none";
}

function renderCropLb() {
  const img = document.getElementById("crop-lb-img");
  if (!img || !img.naturalWidth) return;
  const stage = document.getElementById("crop-lb-stage");
  if (!stage) return;
  const sw = stage.clientWidth;
  const sh = stage.clientHeight;
  const fit = Math.min(sw / img.naturalWidth, sh / img.naturalHeight);
  const w = img.naturalWidth * fit * cropLbZoom;
  const h = img.naturalHeight * fit * cropLbZoom;
  img.style.width = `${w}px`;
  img.style.height = `${h}px`;
  img.style.left = `${(sw - w) / 2 + cropLbPan.x}px`;
  img.style.top = `${(sh - h) / 2 + cropLbPan.y}px`;
  img.style.cursor = cropLbZoom > 1 ? "grab" : "zoom-in";
}

function clampCropLbPan() {
  const img = document.getElementById("crop-lb-img");
  if (!img || !img.naturalWidth) return;
  const stage = document.getElementById("crop-lb-stage");
  if (!stage) return;
  const sw = stage.clientWidth;
  const sh = stage.clientHeight;
  const fit = Math.min(sw / img.naturalWidth, sh / img.naturalHeight);
  const w = img.naturalWidth * fit * cropLbZoom;
  const h = img.naturalHeight * fit * cropLbZoom;
  const minX = Math.min(0, sw - w);
  const maxX = Math.max(0, sw - w);
  const minY = Math.min(0, sh - h);
  const maxY = Math.max(0, sh - h);
  cropLbPan.x = Math.max(minX, Math.min(maxX, cropLbPan.x));
  cropLbPan.y = Math.max(minY, Math.min(maxY, cropLbPan.y));
}

function zoomCropLbAt(factor, clientX, clientY) {
  const img = document.getElementById("crop-lb-img");
  if (!img || !img.naturalWidth) return;
  const stage = document.getElementById("crop-lb-stage");
  if (!stage) return;
  const rect = img.getBoundingClientRect();
  const px = clientX - rect.left;
  const py = clientY - rect.top;
  const newZoom = Math.min(16, Math.max(1, cropLbZoom * factor));
  if (newZoom === 1) {
    cropLbZoom = 1;
    cropLbPan = { x: 0, y: 0 };
    renderCropLb();
    return;
  }
  const k = newZoom / cropLbZoom;
  const u = px / rect.width;
  const v = py / rect.height;
  const w = rect.width * k;
  const h = rect.height * k;
  const sw = stage.clientWidth;
  const sh = stage.clientHeight;
  const left0 = (sw - rect.width) / 2 + cropLbPan.x;
  const top0 = (sh - rect.height) / 2 + cropLbPan.y;
  cropLbPan.x = (px + left0) - u * w - (sw - w) / 2;
  cropLbPan.y = (py + top0) - v * h - (sh - h) / 2;
  cropLbZoom = newZoom;
  clampCropLbPan();
  renderCropLb();
}

function updateCropJsonView() {
  const el = document.querySelector("#crop-json-view");
  if (el) el.textContent = JSON.stringify(buildCropJson(), null, 2);
}

function buildCropJson() {
  const sel = cropSelection;
  const physical = currentMetadata?.physicalScale;
  const mppx = physical?.available ? physical.micronsPerPixelX : null;
  const entry = getSelectedEntry();
  return {
    slide: entry ? {
      kind: entry.kind,
      slideId: selectedResource?.slideId ?? null,
      fileName: entry.slide.fileName,
    } : null,
    selection: {
      x: Math.round(sel.x),
      y: Math.round(sel.y),
      width: Math.round(sel.width),
      height: Math.round(sel.height),
      unit: "px",
    },
    physical: mppx ? {
      widthMicrons: Number((sel.width * mppx).toFixed(2)),
      heightMicrons: Number((sel.height * mppx).toFixed(2)),
      micronsPerPixelX: mppx,
      micronsPerPixelY: physical.micronsPerPixelY,
    } : null,
    threshold: cropThresholdValue,
    maskEnabled: cropMaskEnabled,
    zLevelUsed: cropPreviewZ,
    createdAt: new Date().toISOString(),
    ...(cropModelResult
      ? {
          model: {
            status: cropModelResult.status,
            total: cropModelResult.total,
            summary: cropModelResult.summary,
            detections: cropModelResult.detections,
            inference_ms: cropModelResult.inference_ms,
            model: cropModelResult.model,
          },
        }
      : {}),
  };
}

// Model çalıştırma ve manuel düzenlemelerin (kutu ekleme/silme/taşıma/boyutlandırma/
// etiket değiştirme) tamamı bu fonksiyonla sunucuya, slayta özel append-only bir
// .log dosyasına yazdırılır — böylece bir bölgede ne zaman ne yapıldığı hiç kaybolmaz.
/* =========================================================================
   ARŞİV KAYDI — ImageLog / JsonLog / TerminalLog
   -------------------------------------------------------------------------
   • ImageLog  : model test tuşuna basıldığı andaki ham kesit görüntüsü (PNG)
   • JsonLog   : TEK annotations.json — tüm kutular SLAYT piksel koordinatında,
                 her düzenlemede canlı güncellenir
   • TerminalLog: yapılan her değişikliğin ve hataların okunabilir dökümü
   ========================================================================= */

function newArchiveId(prefix) {
  const rnd = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now().toString(36)}${rnd}`;
}

/** Her kutuya kalıcı kimlik verir; düzenlemeler boyunca aynı kalır. */
function ensureAnnotationIds(detections) {
  for (const det of detections ?? []) {
    if (!det.annotId) det.annotId = newArchiveId("a");
  }
}

/**
 * Kesit içi (model çıktısı) kutu koordinatlarını SLAYT piksel koordinatına çevirir.
 * annotations.json'un ileride ana görselle birlikte kullanılabilmesi için kutuların
 * mutlaka slayt koordinatında olması gerekir.
 */
function annotationsInSlideCoords() {
  const region = cropModelResult?._slideRegion;
  if (!region || !cropModelResult?.detections) return [];
  const sx = region.w / region.imgW;
  const sy = region.h / region.imgH;
  return cropModelResult.detections.map((det) => {
    const [bx1, by1, bx2, by2] = det.bbox;
    return {
      id: det.annotId,
      label: det.class_name,
      bbox: [
        Math.round(region.x + bx1 * sx),
        Math.round(region.y + by1 * sy),
        Math.round(region.x + bx2 * sx),
        Math.round(region.y + by2 * sy),
      ],
      conf: det.confidence == null ? null : Number(det.confidence),
      source: det.manual ? "manual" : "model",
    };
  });
}

/** TerminalLog'a okunabilir bir satır yazar (hatalar dahil). */
async function archiveTerminal(eventType, message, level = "INFO") {
  const slideId = selectedResource?.slideId;
  if (!slideId) return;
  try {
    await fetch(
      `/bif-viewer/api/archive/${encodeURIComponent(slideId)}/terminal?event=${encodeURIComponent(eventType)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...currentAuthHeaders() },
        body: JSON.stringify({ message, level }),
      }
    );
  } catch (error) {
    console.warn("TerminalLog yazılamadı", error);
  }
}

/** Aktif kesitin güncel kutu listesini annotations.json'a yazar (canlı güncelleme). */
async function archiveSyncAnnotations() {
  const slideId = selectedResource?.slideId;
  const entry = getSelectedEntry();
  const sel = cropSelection;
  if (!slideId || !entry || !sel || !cropRegionId || !cropModelResult?._slideRegion) return;

  const physical = currentMetadata?.physicalScale;
  const body = {
    regionId: cropRegionId,
    kind: entry.kind,
    fileName: entry.slide.fileName,
    width: currentMetadata?.width ?? null,
    height: currentMetadata?.height ?? null,
    micronsPerPixel: physical?.available ? physical.micronsPerPixelX : null,
    regionBbox: [Math.round(sel.x), Math.round(sel.y), Math.round(sel.width), Math.round(sel.height)],
    ...(cropRegionImagePath ? { image: cropRegionImagePath } : {}),
    annotations: annotationsInSlideCoords(),
  };

  try {
    const res = await fetch(`/bif-viewer/api/archive/${encodeURIComponent(slideId)}/region`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...currentAuthHeaders() },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (error) {
    console.warn("annotations.json güncellenemedi", error);
    archiveTerminal("json_log", `annotations.json güncellenemedi: ${error.message}`, "ERROR");
  }
}

/** Model çalıştırıldığı andaki ham kesiti ImageLog'a yükler. */
async function archiveRegionImage() {
  const slideId = selectedResource?.slideId;
  if (!slideId || !cropRegionId) return;
  const src = cropPreviewPristine && cropPreviewPristine.width ? cropPreviewPristine : cropPreviewOriginal;
  if (!src || !src.width) return;
  try {
    const blob = await new Promise((resolve, reject) => {
      src.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG üretilemedi"))), "image/png");
    });
    const res = await fetch(
      `/bif-viewer/api/archive/${encodeURIComponent(slideId)}/region/${encodeURIComponent(cropRegionId)}/image`,
      {
        method: "POST",
        headers: { "Content-Type": "image/png", ...currentAuthHeaders() },
        body: blob,
      }
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    cropRegionImagePath = data.path ?? null;
  } catch (error) {
    console.warn("ImageLog yüklenemedi", error);
    archiveTerminal("image_log", `Kesit görüntüsü kaydedilemedi: ${error.message}`, "ERROR");
  }
}

/** Bir olayı hem TerminalLog'a yazar hem de annotations.json'u tazeler. */
async function archiveCropEvent(eventType, message, level = "INFO") {
  const sel = cropSelection;
  if (!sel || !selectedResource?.slideId) return;
  const physical = currentMetadata?.physicalScale;
  const mppx = physical?.available ? physical.micronsPerPixelX : null;
  const geom = `(${Math.round(sel.x)},${Math.round(sel.y)}) ${Math.round(sel.width)}x${Math.round(sel.height)} px`
    + (mppx ? ` / ${(sel.width * mppx).toFixed(1)}x${(sel.height * mppx).toFixed(1)} µm` : "");

  const text = message ?? ARCHIVE_EVENT_TEXT[eventType]?.(sel, geom) ?? `${eventType} — ${geom}`;
  await archiveTerminal(eventType, text, level);
  // Kutu listesini ilgilendiren olaylarda JSON'u da tazele.
  if (cropRegionId && cropModelResult) {
    await archiveSyncAnnotations();
  }
}

const ARCHIVE_EVENT_TEXT = {
  region_selected: (sel, geom) => `Bölge seçildi: ${geom}`,
  region_moved: (sel, geom) => `Bölge taşındı: ${geom}`,
  region_resized: (sel, geom) => `Bölge boyutlandırıldı: ${geom}`,
  manual_move: () => "Kutu taşındı (manuel düzenleme)",
  manual_resize: () => "Kutu boyutlandırıldı (manuel düzenleme)",
  manual_delete: () => "Kutu silindi (manuel düzenleme)",
  manual_new_box: () => "Yeni kutu eklendi (manuel düzenleme)",
  manual_relabel: () => "Kutu etiketi değiştirildi (manuel düzenleme)",
};

function fmtMicron(value) {
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)} mm`;
  return `${value >= 100 ? value.toFixed(0) : value.toFixed(1)} µm`;
}

function blobToBitmap(blob) {
  if (typeof createImageBitmap === "function") {
    return createImageBitmap(blob);
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Görsel çözümlenemedi")); };
    img.src = url;
  });
}

async function renderCropPreview() {
  const sel = cropSelection;
  const meta = currentMetadata;
  if (!sel || !meta || !cropPreviewCanvas) return;

  const loading = document.querySelector("#crop-preview-loading");
  const errEl = document.querySelector("#crop-preview-error");
  const errMsg = document.querySelector("#crop-preview-error-msg");
  if (loading) loading.style.display = "grid";
  if (errEl) errEl.style.display = "none";

  const width = meta.width;
  const tileSize = meta.tileSize;
  const levels = meta.levels;
  if (!levels?.length) {
    if (loading) loading.style.display = "none";
    if (errMsg) errMsg.textContent = "Metadata'da piramit seviyesi yok.";
    if (errEl) errEl.style.display = "grid";
    return;
  }
  const maxLevel = levels.length - 1;

  // En ince seviyeden başlayıp (hedef boyutu aşmadan) en fazla 24 tile üreten
  // bir seviye seç. Hiçbir seviye uymazsa en az tile üreten seviyede kal (asla tam çözünürlüğe düşme).
  let z = maxLevel;
  const wrap = cropPreviewCanvas.parentElement;
  const dpr = window.devicePixelRatio || 1;
  const targetW = Math.min(1600, Math.max(512, (wrap?.clientWidth ?? 640) * dpr));
  const targetH = Math.min(1600, Math.max(512, (wrap?.clientHeight ?? 640) * dpr));
  let bestCount = Infinity;
  for (let l = maxLevel; l >= 0; l--) {
    const info = levels[l];
    const scale = info.width / width;
    const cropW = sel.width * scale;
    const cropH = sel.height * scale;
    const tileCount = Math.ceil(cropW / tileSize) * Math.ceil(cropH / tileSize);
    if (tileCount < bestCount) {
      bestCount = tileCount;
      z = l;
    }
    if (tileCount <= 24 && cropW <= targetW && cropH <= targetH) {
      z = l;
      break;
    }
  }
  cropPreviewZ = z;

  const info = levels[z];
  const scale = info.width / width;
  const selX = sel.x * scale;
  const selY = sel.y * scale;
  const selW = sel.width * scale;
  const selH = sel.height * scale;
  const tileX0 = Math.floor(selX / tileSize);
  const tileY0 = Math.floor(selY / tileSize);
  const tileX1 = Math.floor((selX + selW - 1) / tileSize);
  const tileY1 = Math.floor((selY + selH - 1) / tileSize);

  const original = document.createElement("canvas");
  original.width = Math.max(1, Math.ceil(selW));
  original.height = Math.max(1, Math.ceil(selH));
  const originalCtx = original.getContext("2d");
  originalCtx.fillStyle = "#0b1020";
  originalCtx.fillRect(0, 0, original.width, original.height);

  const token = getAccessToken();
  const kind = selectedResource?.kind === "openslide" ? "openslide" : "bif";
  const id = selectedResource?.slideId;
  const base = kind === "openslide"
    ? `/bif-viewer/api/openslide/tiles/${encodeURIComponent(id)}`
    : `/bif-viewer/api/tiles/${encodeURIComponent(id)}`;

  // En fazla 8 eşzamanlı istek + tile başına 12 sn zaman aşımı (sunucu donarsa siyah ekranda kalma)
  let inFlight = 0;
  const waiters = [];
  async function acquire() {
    if (inFlight < 8) { inFlight++; return; }
    await new Promise((resolve) => waiters.push(resolve));
    inFlight++;
  }
  function release() {
    inFlight--;
    const next = waiters.shift();
    if (next) next();
  }

  async function runAttempt() {
    let drawn = 0;
    let firstError = null;
    originalCtx.fillStyle = "#0b1020";
    originalCtx.fillRect(0, 0, original.width, original.height);
    const tasks = [];
    for (let ty = tileY0; ty <= tileY1; ty++) {
      for (let tx = tileX0; tx <= tileX1; tx++) {
        const url = `${base}/${z}/${tx}/${ty}`;
        tasks.push(
          (async () => {
            try {
              await acquire();
              let blob = cropPreviewTileCache.get(url);
              if (!blob) {
                const controller = new AbortController();
                const timer = setTimeout(() => controller.abort(), 12000);
                try {
                  const res = await fetch(url, {
                    headers: token ? { Authorization: `Bearer ${token}` } : {},
                    signal: controller.signal,
                  });
                  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
                  blob = await res.blob();
                } finally {
                  clearTimeout(timer);
                }
                cropPreviewTileCache.set(url, blob);
                if (cropPreviewTileCache.size > 512) {
                  const oldest = cropPreviewTileCache.keys().next().value;
                  cropPreviewTileCache.delete(oldest);
                }
              }
              const bitmap = await blobToBitmap(blob);
              const dx = Math.round(tx * tileSize - selX);
              const dy = Math.round(ty * tileSize - selY);
              originalCtx.drawImage(bitmap, dx, dy);
              if (typeof bitmap.close === "function") bitmap.close();
              drawn++;
              // İlk tile çizilir çizilmez yükleme katmanını kaldır — görüntü kademeli gelsin
              if (drawn === 1 && loading) loading.style.display = "none";
            } catch (err) {
              if (!firstError) firstError = err;
              console.warn("crop preview tile hatası", err);
            } finally {
              release();
            }
          })()
        );
      }
    }
    await Promise.all(tasks);
    return { drawn, firstError };
  }

  const tileCount = (tileX1 - tileX0 + 1) * (tileY1 - tileY0 + 1);
  let attempt = 0;
  let outcome = null;
  while (attempt < 3) {
    outcome = await runAttempt();
    if (outcome.drawn > 0) break;
    attempt += 1;
    if (attempt < 3) {
      if (loading) loading.style.display = "grid";
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  }

  const clean = document.createElement("canvas");
  clean.width = original.width;
  clean.height = original.height;
  clean.getContext("2d").drawImage(original, 0, 0);

  cropPreviewOriginal = original;
  cropPreviewClean = clean;
  cropPreviewPristine = clean;
  cropPreviewAnnotated = false;
  cropPreviewTileCount = tileCount;
  cropPreviewZoom = 1;
  cropPreviewPan = { x: 0, y: 0 };
  cropPreviewDrag = null;
  if (loading) loading.style.display = "none";
  if (outcome.drawn === 0) {
    const detail = outcome.firstError
      ? String(outcome.firstError.message || outcome.firstError)
      : "Tüm tile istekleri başarısız oldu.";
    console.error("crop preview render başarısız", detail, { z, tileX0, tileY0, tileX1, tileY1, base });
    if (errMsg) errMsg.textContent = detail;
    if (errEl) errEl.style.display = "grid";
    return;
  }
  applyCropPreviewFx();
}

function applyCropPreviewFx() {
  if (!cropPreviewCanvas || !cropPreviewOriginal || !cropPreviewClean) return;
  const ctx = cropPreviewOriginal.getContext("2d");
  const w = cropPreviewOriginal.width;
  const h = cropPreviewOriginal.height;
  // Temiz kopyadan yeniden çiz (maske kapatılınca eski hâl geri gelsin)
  if (cropPreviewClean.width === w && cropPreviewClean.height === h) {
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(cropPreviewClean, 0, 0);
  }
  if (cropMaskEnabled) {
    const imageData = ctx.getImageData(0, 0, w, h);
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      if (lum >= cropThresholdValue) {
        data[i] = 64;
        data[i + 1] = 210;
        data[i + 2] = 235;
        data[i + 3] = 235;
      } else {
        data[i] = Math.floor(data[i] * 0.18);
        data[i + 1] = Math.floor(data[i + 1] * 0.18);
        data[i + 2] = Math.floor(data[i + 2] * 0.18);
        data[i + 3] = 255;
      }
    }
    ctx.putImageData(imageData, 0, 0);
  }
  if (!cropPreviewAnnotated) drawCropAnnotBoxes(ctx);
  renderCropPreviewCanvas();
}

function renderCropPreviewCanvas() {
  const canvas = cropPreviewCanvas;
  if (!canvas || !cropPreviewOriginal || !cropPreviewOriginal.width) return;
  const wrap = canvas.parentElement;
  if (!wrap) return;
  const bw = wrap.clientWidth;
  const bh = wrap.clientHeight;
  if (bw <= 0 || bh <= 0) return;
  const fit = Math.min(bw / cropPreviewOriginal.width, bh / cropPreviewOriginal.height);
  const dispW = cropPreviewOriginal.width * fit * cropPreviewZoom;
  const dispH = cropPreviewOriginal.height * fit * cropPreviewZoom;
  const dpr = window.devicePixelRatio || 1;
  canvas.style.width = `${dispW}px`;
  canvas.style.height = `${dispH}px`;
  canvas.width = Math.round(dispW * dpr);
  canvas.height = Math.round(dispH * dpr);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, dispW, dispH);
  ctx.drawImage(cropPreviewOriginal, cropPreviewPan.x, cropPreviewPan.y, dispW, dispH);
  canvas.style.cursor = cropPreviewZoom > 1 ? "grab" : "zoom-in";
}

function clampCropPreviewPan() {
  if (!cropPreviewCanvas || !cropPreviewOriginal) return;
  const wrap = cropPreviewCanvas.parentElement;
  if (!wrap) return;
  const bw = wrap.clientWidth;
  const bh = wrap.clientHeight;
  const fit = Math.min(bw / cropPreviewOriginal.width, bh / cropPreviewOriginal.height);
  const dispW = cropPreviewOriginal.width * fit * cropPreviewZoom;
  const dispH = cropPreviewOriginal.height * fit * cropPreviewZoom;
  const minX = Math.min(0, bw - dispW);
  const minY = Math.min(0, bh - dispH);
  cropPreviewPan.x = Math.max(minX, Math.min(0, cropPreviewPan.x));
  cropPreviewPan.y = Math.max(minY, Math.min(0, cropPreviewPan.y));
}

function zoomCropPreviewAt(factor, clientX, clientY) {
  if (!cropPreviewCanvas || !cropPreviewOriginal) return;
  const canvas = cropPreviewCanvas;
  const rect = canvas.getBoundingClientRect();
  const px = clientX - rect.left;
  const py = clientY - rect.top;
  const wrap = canvas.parentElement;
  if (!wrap) return;
  const newZoom = Math.min(14, Math.max(1, cropPreviewZoom * factor));
  if (newZoom === 1) {
    cropPreviewZoom = 1;
    cropPreviewPan = { x: 0, y: 0 };
    renderCropPreviewCanvas();
    return;
  }
  const k = newZoom / cropPreviewZoom;
  const fit = Math.min(wrap.clientWidth / cropPreviewOriginal.width, wrap.clientHeight / cropPreviewOriginal.height);
  const oldW = cropPreviewOriginal.width * fit * cropPreviewZoom;
  const oldH = cropPreviewOriginal.height * fit * cropPreviewZoom;
  const u = (px - cropPreviewPan.x) / oldW;
  const v = (py - cropPreviewPan.y) / oldH;
  cropPreviewPan.x = px - u * oldW * k;
  cropPreviewPan.y = py - v * oldH * k;
  cropPreviewZoom = newZoom;
  clampCropPreviewPan();
  renderCropPreviewCanvas();
}

function drawCropAnnotBoxes(ctx) {
  if (!cropModelResult?.detections) return;
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  for (const det of cropModelResult.detections) {
    const [x1, y1, x2, y2] = det.bbox;
    const bw = Math.min(x2, w) - x1;
    const bh = Math.min(y2, h) - y1;
    if (bw <= 0 || bh <= 0) continue;
    ctx.save();
    ctx.strokeStyle = cropAnnotColor(det.class_name);
    ctx.lineWidth = 2;
    ctx.shadowColor = cropAnnotColor(det.class_name);
    ctx.shadowBlur = 8;
    ctx.strokeRect(x1 + 1, y1 + 1, bw - 2, bh - 2);
    ctx.restore();
  }
}

async function onCropModelClick() {
  const status = document.querySelector("#crop-status");
  const badge = document.querySelector("#crop-model-badge");
  setCropRobotBusy(true);
  if (status) status.textContent = "Model çalışıyor, hücreler tespit ediliyor...";

  try {
    const payload = buildCropJson();
    const result = await runModelOnSelection(payload);
    if (badge) {
      badge.style.display = "inline-block";
      badge.textContent = `${result.total ?? 0} hücre`;
      badge.title = "Model etiketleme tamamlandı";
    }
    if (status) status.textContent = `${result.total ?? 0} hücre tespit edildi (${result.inference_ms} ms).`;
  } catch (error) {
    if (badge) badge.style.display = "none";
    if (status) status.textContent = `Model hatası: ${error.message}`;
    archiveTerminal("model_error", `Model çalıştırılamadı: ${error.message}`, "ERROR");
  } finally {
    setCropRobotBusy(false);
  }
}

async function runModelOnSelection(selectionJson) {
  // ============ YOLOv8 MODEL ENTEGRASYONU ============
  // Kırp bölgesi (stitch edilmiş orijinal) /bif-viewer/model-api/predict'e gönderilir.
  // Model servisi (bif-viewer-model) detections + summary + annotated_image döner.
  if (!cropPreviewOriginal || !cropPreviewOriginal.width) {
    throw new Error("Bölge önizlemesi henüz hazır değil — biraz bekle ve tekrar dene.");
  }

  // Modele HER ZAMAN gerçek ham (etiketlenmemiş) bölge gönderilir — aksi hâlde model
  // ikinci kez çalıştırıldığında bir önceki çalıştırmanın çizdiği kutuları da içeren
  // görüntüyü tekrar işaretler ve her hücre iki kez kutulanmış gibi görünür.
  const src = cropPreviewPristine && cropPreviewPristine.width ? cropPreviewPristine : cropPreviewOriginal;
  const blob = await new Promise((resolve, reject) => {
    src.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG üretilemedi"))), "image/png");
  });

  const token = getAccessToken();
  const res = await fetch("/bif-viewer/model-api/predict", {
    method: "POST",
    headers: {
      "Content-Type": "image/png",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: blob,
  });

  if (!res.ok) {
    let detail = "";
    try {
      const err = await res.json();
      detail = err.detail || "";
    } catch {
      detail = res.statusText;
    }
    throw new Error(`Model servisi ${res.status}: ${detail}`);
  }

  const data = await res.json();
  const sel = cropSelection;
  data._slideRegion = {
    x: sel.x,
    y: sel.y,
    w: sel.width,
    h: sel.height,
    imgW: cropPreviewOriginal.width,
    imgH: cropPreviewOriginal.height,
  };
  cropModelResult = data;

  // ---- ARŞİV: model test tuşuna basıldığı an ----
  // Her kutuya kalıcı kimlik ver (sonraki düzenlemelerde aynı kutu izlenebilsin),
  // bu kesit için yeni bir bölge kimliği üret, ham görüntüyü ImageLog'a yaz ve
  // annotations.json'a ilk hâlini kaydet.
  ensureAnnotationIds(data.detections);
  cropRegionId = newArchiveId("r");
  cropRegionImagePath = null;
  await archiveRegionImage();
  await archiveSyncAnnotations();
  const summaryText = Object.entries(data.summary ?? {})
    .map(([name, count]) => `${name}:${count}`)
    .join(", ") || "tespit yok";
  archiveTerminal(
    "model_run",
    `Model çalıştırıldı — bölge ${cropRegionId} @ (${Math.round(sel.x)},${Math.round(sel.y)}) `
      + `${Math.round(sel.width)}x${Math.round(sel.height)} px | ${data.total ?? 0} hücre `
      + `(${data.inference_ms} ms) | ${summaryText}`
  );

  // Ana görselde kutuları otomatik göster
  cropAnnotVisible = true;
  updateCropAnnotToggle();
  updateCropOverlayVisibility();
  ensureCropRedrawLoop();
  redrawCropOverlay();

  // Etiketli görüntüyü önizleme kanvasına çiz
  if (data.annotated_image && cropPreviewOriginal) {
    const img = new Image();
    img.onload = () => {
      const ctx = cropPreviewOriginal.getContext("2d");
      cropPreviewOriginal.width = img.width;
      cropPreviewOriginal.height = img.height;
      ctx.drawImage(img, 0, 0);
      // Etiketli görüntüyü de temiz kopya yap (maske kapatılınca bu hâl geri gelsin)
      cropPreviewAnnotated = true;
      cropPreviewClean = document.createElement("canvas");
      cropPreviewClean.width = img.width;
      cropPreviewClean.height = img.height;
      cropPreviewClean.getContext("2d").drawImage(img, 0, 0);
      renderCropPreviewCanvas();
    };
    img.src = data.annotated_image;
  }

  renderCropResults(data);
  updateCropJsonView();

  return data;
}

function renderCropResults(data) {
  const box = document.querySelector("#crop-results");
  if (!box) return;
  const summary = data.summary ?? {};
  const classes = Object.keys(summary);
  const chips = classes
    .map((name) => {
      const color = cropAnnotColor(name);
      return `
      <div style="display:flex; align-items:center; gap:8px; padding:8px 12px; border-radius:12px; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.08);">
        <span style="width:10px; height:10px; border-radius:3px; background:${color}; flex:none;"></span>
        <span style="font-size:0.82rem; color:#cfe0ff; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(name)}</span>
        <span style="font-weight:800; font-size:0.95rem; color:#f5f7fa;">${summary[name]}</span>
      </div>`;
    })
    .join("");
  box.innerHTML = `
    <div style="padding:12px; border-radius:16px; background:linear-gradient(135deg, rgba(47,124,246,0.14), rgba(74,222,128,0.08)); border:1px solid rgba(125,162,255,0.3);">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
        <span style="font-size:0.8rem; font-weight:800; letter-spacing:0.1em; color:#7da2ff; text-transform:uppercase;">Model Sonuçları</span>
        <span style="font-size:0.78rem; color:rgba(245,247,250,0.55);">${data.inference_ms ?? "—"} ms</span>
      </div>
      ${classes.length ? `<div style="display:grid; grid-template-columns:1fr 1fr; gap:6px;">${chips}</div>` : ""}
      <div style="margin-top:10px; padding-top:10px; border-top:1px dashed rgba(125,162,255,0.25); display:flex; justify-content:space-between; align-items:center;">
        <span style="font-size:0.85rem; color:rgba(245,247,250,0.7);">Toplam tespit</span>
        <span style="font-size:1.2rem; font-weight:900; color:#6ca5ff;">${data.total ?? 0}</span>
      </div>
    </div>
  `;
  box.style.display = "block";
}

async function copyCropJson() {
  const text = JSON.stringify(buildCropJson(), null, 2);
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }
  const status = document.querySelector("#crop-status");
  if (status) status.textContent = "JSON panoya kopyalandı.";
}

function downloadCropImage(annotated = false) {
  const status = document.querySelector("#crop-status");
  if (!cropPreviewOriginal || !cropPreviewOriginal.width) {
    if (status) status.textContent = "Önizleme henüz hazır değil — bölge yükleniyor, biraz bekle.";
    return;
  }
  const sel = cropSelection;
  const id = selectedResource?.slideId ?? "slide";
  const base = `crop_${id}_x${Math.round(sel.x)}_y${Math.round(sel.y)}_${Math.round(sel.width)}x${Math.round(sel.height)}`;
  if (status) status.textContent = "Görüntü hazırlanıyor...";

  const downloadLink = (url, name) => {
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  if (annotated) {
    if (cropModelResult?.detections?.length) {
      const ann = document.createElement("canvas");
      ann.width = cropPreviewOriginal.width;
      ann.height = cropPreviewOriginal.height;
      const annCtx = ann.getContext("2d");
      annCtx.drawImage(cropPreviewOriginal, 0, 0);
      drawCropAnnotBoxes(annCtx);
      downloadLink(ann.toDataURL("image/png"), `${base}_annotated.png`);
    } else if (cropModelResult?.annotated_image) {
      downloadLink(cropModelResult.annotated_image, `${base}_annotated.png`);
    } else {
      if (status) status.textContent = "Önce modele bölge gönder (robot butonu).";
      return;
    }
    if (status) status.textContent = "Annotation'lı görüntü indirildi.";
    return;
  }

  const plainUrl = cropPreviewOriginal.toDataURL("image/png");
  downloadLink(plainUrl, `${base}.png`);

  if (cropModelResult) {
    const { _slideRegion, ...cleanResult } = cropModelResult;
    const jsonUrl = URL.createObjectURL(
      new Blob([JSON.stringify(cleanResult, null, 2)], { type: "application/json" })
    );
    downloadLink(jsonUrl, `${base}_results.json`);
    setTimeout(() => URL.revokeObjectURL(jsonUrl), 4000);
    if (status) status.textContent = "Görüntü + JSON indirildi.";
  } else if (status) {
    status.textContent = "Görüntü indirildi.";
  }
}

function closeCropPanel() {
  cropPanelOpen = false;
  cropPanelStage = 0;
  cropPanelPrevState = null;
  cropPanelMinimized = false;
  if (cropPanelSlot) {
    cropPanelSlot.innerHTML = "";
    cropPanelSlot.style.position = "absolute";
    cropPanelSlot.style.zIndex = "32";
    cropPanelSlot.style.left = "16px";
    cropPanelSlot.style.top = "72px";
    cropPanelSlot.style.margin = "0";
    cropPanelSlot.style.width = "";
    cropPanelSlot.style.height = "";
    cropPanelSlot.style.maxWidth = "";
    cropPanelSlot.style.maxHeight = "calc(100% - 88px)";
    cropPanelSlot.style.bottom = "";
  }
  cropPreviewCanvas = null;
  closeCropEditor();
}

function clearCropSelection() {
  setCropMode(false);
  cropSelection = null;
  cropDrag = null;
  cancelCropRedrawLoop();
  closeCropPanel();
  updateCropClearButton();
  cropModelResult = null;
  cropAnnotVisible = false;
  cropCustomLabels = [];
  // Arsiv bolge kimligi kesit basina; yeni kesitte yenisi uretilir.
  cropRegionId = null;
  cropRegionImagePath = null;
  updateCropAnnotToggle();
  updateCropOverlayVisibility();
  redrawCropOverlay();
  hideCropAnnotTip();
  setStatus("Bölge seçimi temizlendi.", false);
}

function cropReset() {
  setCropMode(false);
  cropSelection = null;
  cropDrag = null;
  cancelCropRedrawLoop();
  closeCropPanel();
  updateCropClearButton();
  cropPreviewOriginal = null;
  cropPreviewClean = null;
  cropPreviewPristine = null;
  cropPreviewAnnotated = false;
  cropPreviewZ = null;
  cropThresholdValue = 128;
  cropMaskEnabled = false;
  cropModelResult = null;
  cropAnnotVisible = false;
  cropCustomLabels = [];
  updateCropAnnotToggle();
  updateCropOverlayVisibility();
  redrawCropOverlay();
  hideCropAnnotTip();
}

async function bootstrapApp() {
  app.innerHTML = `
    <div style="min-height: 100vh; display: grid; place-items: center; background: linear-gradient(180deg, #0b1020 0%, #05070d 100%); color: #f5f7fa; font-family: 'SF Pro Display', 'Segoe UI', sans-serif;">
      <div style="text-align: center;">
        <div style="font-size: 1.1rem; color: #9fbeff; margin-bottom: 8px;">BIF Viewer</div>
        <div style="color: rgba(245,247,250,0.54); font-size: 0.9rem;">Kimlik doğrulanıyor...</div>
      </div>
    </div>
  `;

  await initAuth();
  onTokenRefresh((token) => {
    refreshViewerAuthHeaders(token);
  });

  const token = getAccessToken();
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  
  const meResponse = await fetch("/bif-viewer/api/me", { headers: headers });
  if (!meResponse.ok) {
    console.warn("Me API hatası:", meResponse.status);
  }

  const userInfo = getUserInfo();
  const isMaster = hasRole("master");

  if (isMaster) {
    setupMasterUI(userInfo);
    await loadMasterData();
    return;
  }

  setupUI(false, userInfo);

  // Sayfa yenilendiğinde en son açık olan slaytı geri getir (liste yüklenince
  // hâlâ mevcut mu diye loadSlides/loadOpenSlideSlides zaten doğruluyor).
  selectedResource = loadPersistedSelection();

  await Promise.all([
    loadSlides(null, false),
    loadOpenSlideSlides(null, false),
  ]);
  await renderViewer();
  setViewerClosable(Boolean(selectedResource));
  startMetricsPolling();

  // Sayfa kapanırken/gizlenirken taramanın son hâlini yaz; böylece kullanıcı
  // başka bir sayfaya gidip geri geldiğinde etiketler ve ilerleme yerinde olur.
  window.addEventListener("pagehide", () => saveScanState({ force: true }));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") saveScanState({ force: true });
  });
}

bootstrapApp().catch((error) => {
  console.error("Failed to bootstrap viewer", error);
  app.innerHTML = `
    <div style="min-height: 100vh; display: grid; place-items: center; background: #05070d; color: #ffb4b4; font-family: sans-serif;">
      <div>Uygulama başlatılamadı: ${error.message}</div>
    </div>
  `;
});
