# J Family 版本紀錄

## v1.6 第一階段：帳號安全（2026-10-03）

| 檔案 | 修改內容 |
|---|---|
| js/config.js | 新增 Firebase Authentication 初始化 |
| js/auth.js | 登入改用 Firebase Authentication；密碼不再存放於資料庫；角色由伺服器讀取；「記住帳密」改為只記住 Email；新註冊帳號預設為待核准；修改密碼需輸入目前密碼；移除預設管理員帳號自動建立功能 |
| index.html | 改用登入狀態監聽啟動系統；個人資料新增「目前密碼」欄位，Email 改為唯讀 |
| js/admin.js | 帳號管理新增「待核准」狀態與核准按鈕；管理員只能修改姓名（Email 為登入帳號） |
| database.rules.json | 新增資料庫安全規則（含 ticketCounter 工單編號計數器）：未登入或待核准者無法讀寫任何資料；一般成員不能修改自己的角色；國定假日僅管理員可修改 |

既有功能（總覽、工單、出勤、庫存、行事曆、管理）畫面與操作不變。

## v1.6 第二階段：工作日報與油資報表（2026-10-03）

| 檔案 | 修改內容 |
|---|---|
| js/dailyreport.js | 新檔：工作日報表單（客戶／案場／產品下拉與自行新增、拜訪人員自動帶入、工時跨夜、路線多目的地與油資計算、處理事項、支出）、日報紀錄（修改、刪除、複製 LINE 格式文字）、油資報表與 Excel 匯出（比照出差記錄表格式，檔名 YYYYMM_出差油資_姓名.xlsx）、管理頁的主檔停用與成員設定（中文姓名、所屬辦公室） |
| index.html | 導覽列新增「工作日報」、「油資報表」；管理頁新增主檔與成員設定區塊；右下角＋按鈕在日報頁為新增日報 |
| css/style.css | 新增日報相關樣式（檔案末端，既有樣式未更動） |
| database.rules.json | 新增 master、reports、settings、exportLog 規則：日報僅本人可修改刪除，系統設定僅管理員可修改 |

新增資料節點：master/customers、master/sites、master/products、reports/年-月/編號、settings、exportLog。users 新增 cname（中文姓名）、office（所屬辦公室）欄位。既有節點未更動。
公里數暫為手動輸入，Google 自動計算距離排在 v1.8。
