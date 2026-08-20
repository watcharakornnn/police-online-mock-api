/**
 * Mock API Server
 * ตอบ mock data ในรูปแบบเดียวกับ staging API (share-ui format)
 * รันด้วย: node mock-server.js
 * Port: 3001
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile, spawn } = require('child_process');

// Load mock data from the TS file (parse the JSON array)
const mockDataPath = path.join(__dirname, 'src/app/services/mock-case-data.ts');
const mockDataContent = fs.readFileSync(mockDataPath, 'utf-8');
// Extract the JSON array from the TS file
const jsonMatch = mockDataContent.match(/\[[\s\S]*\]/);
const MOCK_CASE_DATA = jsonMatch ? JSON.parse(jsonMatch[0]) : [];

console.log(`[Mock Server] Loaded ${MOCK_CASE_DATA.length} cases from mock-case-data.ts`);

// Codex CLI helper — calls `codex exec` with timeout and fallback
function callCodex(promptText, timeoutMs = 22000) {
    return new Promise((resolve, reject) => {
        try {
            let stdout = '';
            let stderr = '';
            const child = spawn('codex', ['exec', '-s', 'read-only', promptText], {
                env: { ...process.env },
                stdio: ['pipe', 'pipe', 'pipe']
            });

            // Close stdin immediately to prevent "Reading additional input from stdin..." hang
            child.stdin.write('\n');
            child.stdin.end();

            child.stdout.on('data', (data) => { stdout += data.toString(); });
            child.stderr.on('data', (data) => { stderr += data.toString(); });

            // Timeout
            const timer = setTimeout(() => {
                child.kill('SIGTERM');
                reject(new Error(`codex timeout after ${timeoutMs}ms`));
            }, timeoutMs);

            child.on('close', (code) => {
                clearTimeout(timer);
                const answer = stdout.trim();
                if (code !== 0 || !answer) {
                    reject(new Error(`codex exit ${code}: ${stderr.substring(0, 200) || 'no output'}`));
                    return;
                }
                resolve(answer);
            });

            child.on('error', (err) => {
                clearTimeout(timer);
                reject(err);
            });
        } catch (e) {
            reject(e);
        }
    });
}

// Fallback answer builder (tier 2) — parse case data from text
function buildFallbackAnswer(inputText) {
    const trackingMatch = inputText.match(/เลขติดตาม[:\s]*([A-Za-z0-9]+)/);
    const caseTypeMatch = inputText.match(/ประเภทคดี[:\s]*([^\n\-]+)/);
    const victimMatch = inputText.match(/ผู้เสียหาย[:\s]*([^\n\-]+)/);
    const damageMatch = inputText.match(/มูลค่าเสียหาย[:\s]*([^\n\-]+)/);
    const behaviorMatch = inputText.match(/พฤติการณ์[:\s]*([^\n]+)/);

    if (trackingMatch || caseTypeMatch || victimMatch) {
        const tracking = (trackingMatch ? trackingMatch[1] : '').trim();
        const caseType = (caseTypeMatch ? caseTypeMatch[1] : 'ไม่ระบุ').trim();
        const victim = (victimMatch ? victimMatch[1] : 'ไม่ระบุ').trim();
        const damage = (damageMatch ? damageMatch[1] : 'ไม่ระบุ').trim();
        const behavior = (behaviorMatch ? behaviorMatch[1] : '').trim().substring(0, 150);

        return `AI วิเคราะห์คดี ${tracking}: เป็นคดี${caseType}\n` +
            `ผู้เสียหาย: ${victim} มูลค่าความเสียหาย ${damage}\n\n` +
            `จากพฤติการณ์: "${behavior}${behavior.length >= 150 ? '...' : ''}"\n\n` +
            `ข้อเสนอแนะ:\n` +
            `1. เร่งอายัดบัญชีปลายทางภายใน 72 ชั่วโมง (พ.ร.ก. มาตรการป้องกันฯ 2566)\n` +
            `2. ขอข้อมูลเดินบัญชีย้อนหลัง 6 เดือนจากธนาคารที่เกี่ยวข้อง\n` +
            `3. ตรวจสอบเส้นทางการเงินว่ามีบัญชีม้าชั้นต่อไปหรือไม่\n` +
            `4. ประสาน TDEX เพื่อระงับหมายเลขโทรศัพท์ที่ใช้ติดต่อผู้เสียหาย\n` +
            `5. ค้นหาคดีอื่นที่มีรูปแบบ/บัญชีปลายทางเดียวกัน (Network Intelligence)\n\n` +
            `หมายเหตุ: คดีลักษณะนี้มีความเข้าข่าย${caseType}ตาม พ.ร.ก.มาตรการป้องกันและปราบปรามอาชญากรรมทางเทคโนโลยี พ.ศ. 2566 ` +
            `แนะนำให้ตรวจสอบบัญชีปลายทางเทียบกับฐานข้อมูลบัญชีม้าที่มีอยู่ในระบบ`;
    }

    // Tier 3: canned fallback
    return 'AI วิเคราะห์: คดีนี้มีลักษณะเป็นการหลอกลวงออนไลน์ ควรอายัดบัญชีปลายทางโดยเร็ว ' +
        'และตรวจสอบเส้นทางการเงินว่ามีบัญชีม้าชั้นต่อไปหรือไม่ ' +
        'แนะนำให้ค้นหาคดีอื่นที่มีรูปแบบเดียวกันผ่าน Network Intelligence';
}

const PORT = 14121;

// Helper: wrap response in share-ui format
function success(data) {
    return JSON.stringify({ IsSuccess: true, Value: data, Message: '' });
}

function successList(data, total) {
    return JSON.stringify({ IsSuccess: true, Value: { Data: data, TotalCount: total || data.length }, Message: '' });
}

// Build case info response
function buildCaseInfo(mockCase) {
    return {
        CASE_ID: mockCase.InstId,
        CASE_TYPE_ID: 1,
        CASE_TYPE_NAME: mockCase.CaseTypeName,
        CASE_TYPE_GROUP_NAME: mockCase.CaseTypeGroupName,
        DAMAGE_VALUE: mockCase.DamageValue,
        CASE_INFORMER_FIRSTNAME: (mockCase.Ext5 || '').split(' ')[0] || 'สมชาย',
        CASE_INFORMER_LASTNAME: (mockCase.Ext5 || '').split(' ')[1] || 'ใจดี',
        CASE_INFORMER_DATE: '1990-05-15T00:00:00',
        CASE_REMARK: mockCase.OptionalData,
        INFORMER_TEL: '081-234-5678',
        IS_WALKIN: false,
        CASE_BEHAVIOR: mockCase.OptionalData,
        LANGUAGE_ID: 1,
    };
}

function buildBpmProcInst(mockCase) {
    return {
        INST_ID: mockCase.InstId,
        TRACKING_CODE: mockCase.TrackingCode,
        DATA_ID: mockCase.InstId,
        DOCUMENT_ID: 'DOC-' + mockCase.InstId,
        FORM_IO_ID: 'FORM-001',
        WF_INSTANCE_ID: mockCase.InstId,
        CREATE_DATE: mockCase.CreateDate,
        STATUS_CODE: mockCase.StatusCode,
        STATUS_NAME: mockCase.StatusName,
        // ใช้ C05 ตาม dashboard.component.ts _caseStatus enum
        GROUP_STATUS_CODE: mockCase.StatusCode === 'COM' ? 'C05' : 'C01',
        CATEGORY_NAME: 'คดีออนไลน์',
        CASE_CATEGORY_ID: 1,
        CASE_TYPE_NAME: mockCase.CaseTypeName,
        OFFICER_FULL_NAME: mockCase.OfficerFullName,
        INVESTIGATE_OFFICER_NAME: mockCase.InvestigateOfficerName,
        ORGANIZE_NAME_THA: mockCase.OrganizeAbbr,
        ORGANIZE_NAME_THA_LEVEL2: mockCase.OrganizeNameLevel2,
        ORGANIZE_NAME_THA_LEVEL3: mockCase.OrganizeNameLevel3,
        ORGANIZE_NAME_THA_LEVEL4: mockCase.OrganizeAbbr,
        ORG_ID: 1,
        EXT1: mockCase.Ext1,
        EXT2: mockCase.Ext2,
        EXT3: mockCase.Ext3,
        EXT4: '0',
        EXT5: mockCase.Ext5,
        PERSONAL_ID: 1,
        OFFICER_ID: 1,
        INVESTIGATE_OFFICER_ID: 2,
        REMARK: '',
        CASE_TYPE_GROUP_NAME: mockCase.CaseTypeGroupName,
    };
}

const server = http.createServer((req, res) => {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');

    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    const url = req.url.toLowerCase();
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
        console.log(`[${req.method}] ${req.url}`);

        // Strip /api prefix if present
        const cleanUrl = url.replace('/api/', '/').replace('/api', '/');

        // ========== Demo User Accounts (1 user = 1 role) ==========
        const DEMO_USERS = {
            '3211234567890': { UserId: 0, RoleId: 76, RoleCode: 'ROOT', FirstNameTH: 'วัชรากร', LastNameTH: 'ทดสอบ', Rank: 'พ.ต.ท.', RoleName: 'แอดมิน ตร.', password: '67890' },
            '1234567890001': { UserId: 1, RoleId: 76, RoleCode: 'ROOT', FirstNameTH: 'สมชาย', LastNameTH: 'ดีเด่น', Rank: 'พ.ต.ท.', RoleName: 'แอดมิน ตร.' },
            '1234567890002': { UserId: 2, RoleId: 101, RoleCode: 'OFFICER', FirstNameTH: 'วิชัย', LastNameTH: 'สุขสวัสดิ์', Rank: 'ร.ต.อ.', RoleName: 'พนักงานสอบสวน' },
            '1234567890003': { UserId: 3, RoleId: 102, RoleCode: 'OFFICER_ANALYST', FirstNameTH: 'ธนพล', LastNameTH: 'เจริญกิจ', Rank: 'ร.ต.อ.', RoleName: 'พนักงานสืบสวน' },
            '1234567890004': { UserId: 4, RoleId: 103, RoleCode: 'MNG_BK', FirstNameTH: 'ประเสริฐ', LastNameTH: 'ศรีสุข', Rank: 'พ.ต.อ.', RoleName: 'ผู้บังคับบัญชา' },
            '1234567890005': { UserId: 5, RoleId: 104, RoleCode: 'EXECUTIVE', FirstNameTH: 'สุรศักดิ์', LastNameTH: 'ชัยวัฒน์', Rank: 'พล.ต.ท.', RoleName: 'ผู้บริหาร' },
            '1234567890006': { UserId: 6, RoleId: 105, RoleCode: 'ADMIN_ACSC', FirstNameTH: 'อรุณ', LastNameTH: 'แสงทอง', Rank: 'พ.ต.ท.', RoleName: 'แอดมิน ACSC' },
            '1234567890007': { UserId: 7, RoleId: 106, RoleCode: 'ROOTTRAIN', FirstNameTH: 'มนัส', LastNameTH: 'พงษ์เจริญ', Rank: 'ร.ต.ท.', RoleName: 'ดูข้อมูลได้อย่างเดียว' },
            '1234567890008': { UserId: 8, RoleId: 107, RoleCode: 'INVEST_EXEC', FirstNameTH: 'กิตติ', LastNameTH: 'วรรณภา', Rank: 'พ.ต.อ.', RoleName: 'สืบบริหาร' },
            '1234567890009': { UserId: 9, RoleId: 108, RoleCode: 'ADMIN_BCH', FirstNameTH: 'นิรันดร์', LastNameTH: 'อมรเทพ', Rank: 'พ.ต.ท.', RoleName: 'Admin บช.' },
            '1234567890010': { UserId: 10, RoleId: 109, RoleCode: 'MNG_CCIB', FirstNameTH: 'วีระ', LastNameTH: 'พัฒนกุล', Rank: 'พ.ต.อ.', RoleName: 'Admin บช.สอท.' },
            '1234567890011': { UserId: 11, RoleId: 110, RoleCode: 'OFFICER_ACSC', FirstNameTH: 'ปิยะ', LastNameTH: 'สมบูรณ์', Rank: 'ร.ต.อ.', RoleName: 'พนักงานสอบสวน ACSC' },
            '1234567890012': { UserId: 12, RoleId: 111, RoleCode: 'MNG_REGION', FirstNameTH: 'อำนาจ', LastNameTH: 'รุ่งเรือง', Rank: 'พ.ต.อ.', RoleName: 'ADMIN บก./ภ.จว.' },
            '1234567890013': { UserId: 13, RoleId: 112, RoleCode: 'OFFICER1441', FirstNameTH: 'พิชัย', LastNameTH: 'ทองดี', Rank: 'ด.ต.', RoleName: 'เจ้าหน้าที่1441' },
            '1234567890014': { UserId: 14, RoleId: 113, RoleCode: 'MNG_KK', FirstNameTH: 'สุทธิ', LastNameTH: 'กล้าหาญ', Rank: 'พ.ต.ท.', RoleName: 'Admin สน./สภ.' },
            '1234567890015': { UserId: 15, RoleId: 114, RoleCode: 'CYBER_TRAINING', FirstNameTH: 'ณัฐพล', LastNameTH: 'ไซเบอร์', Rank: 'ร.ต.อ.', RoleName: 'ครูไซเบอร์' },
        };

        // Track current logged-in user (by last auth request)
        let currentUser = DEMO_USERS['1234567890001']; // default: admin

        // ========== Auth / Login ==========
        if (url.includes('user/auth') || url.includes('user/challenge') || url.includes('user/renew') || url.includes('user/refresh') || url.includes('user/get-otp')) {
            if (url.includes('challenge')) {
                res.end(success({ Nonce: 'mock-nonce-12345' }));
            } else if (url.includes('get-otp')) {
                res.end(JSON.stringify({ IsSuccess: true, Message: 'OTP sent (mock)' }));
            } else {
                // Detect username from body
                const params = body ? JSON.parse(body) : {};
                const username = params.Username || params.username || params.personalId || '';
                const password = params.Password || params.password || '';
                const matchedUser = DEMO_USERS[username];

                // Check password if user has one set
                if (matchedUser && matchedUser.password && matchedUser.password !== password) {
                    res.end(JSON.stringify({ IsSuccess: false, Value: null, Message: 'รหัสผ่านไม่ถูกต้อง' }));
                    return;
                }

                currentUser = matchedUser || DEMO_USERS['1234567890001'];
                console.log(`[Auth] Login: ${username} → ${currentUser.Rank}${currentUser.FirstNameTH} ${currentUser.LastNameTH} (${currentUser.RoleName})`);

                const header = Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
                const payload = Buffer.from(JSON.stringify({
                    UserId: currentUser.UserId, UserType: 2, PersonalId: currentUser.UserId,
                    OrganizeId: 1, OrganizeLevel: 1, OrganizeRootId: 1,
                    LastAccessDateTime: new Date().toISOString(),
                    FullName: `${currentUser.Rank}${currentUser.FirstNameTH} ${currentUser.LastNameTH}`,
                    FirstNameTH: currentUser.FirstNameTH, LastNameTH: currentUser.LastNameTH,
                    exp: Math.floor(Date.now() / 1000) + 86400,
                    iat: Math.floor(Date.now() / 1000)
                })).toString('base64url');
                const token = header + '.' + payload + '.mock_signature_valid';
                res.end(success({ Token: token, RefreshToken: 'mock-refresh-token-valid' }));
            }
            return;
        }

        // ========== Role / Menu ==========
        const MOCK_ROLES = [
            { RoleId: 76, RoleName: 'แอดมิน ตร.', RoleCode: 'ROOT', AppCode: 'OfficerHome', IsDefault: true },
            { RoleId: 101, RoleName: 'พนักงานสอบสวน', RoleCode: 'OFFICER', AppCode: 'OfficerHome' },
            { RoleId: 102, RoleName: 'พนักงานสืบสวน', RoleCode: 'OFFICER_ANALYST', AppCode: 'OfficerHome' },
            { RoleId: 103, RoleName: 'ผู้บังคับบัญชา', RoleCode: 'MNG_BK', AppCode: 'OfficerHome' },
            { RoleId: 104, RoleName: 'ผู้บริหาร', RoleCode: 'EXECUTIVE', AppCode: 'OfficerHome' },
            { RoleId: 105, RoleName: 'แอดมิน ACSC', RoleCode: 'ADMIN_ACSC', AppCode: 'OfficerHome' },
            { RoleId: 106, RoleName: 'ดูข้อมูลได้อย่างเดียว', RoleCode: 'ROOTTRAIN', AppCode: 'OfficerHome' },
            { RoleId: 107, RoleName: 'สืบบริหาร', RoleCode: 'INVEST_EXEC', AppCode: 'OfficerHome' },
            { RoleId: 108, RoleName: 'Admin บช.', RoleCode: 'ADMIN_BCH', AppCode: 'OfficerHome' },
            { RoleId: 109, RoleName: 'Admin บช.สอท.', RoleCode: 'MNG_CCIB', AppCode: 'OfficerHome' },
            { RoleId: 110, RoleName: 'พนักงานสอบสวน ACSC', RoleCode: 'OFFICER_ACSC', AppCode: 'OfficerHome' },
            { RoleId: 111, RoleName: 'ADMIN บก./ภ.จว.', RoleCode: 'MNG_REGION', AppCode: 'OfficerHome' },
            { RoleId: 112, RoleName: 'เจ้าหน้าที่1441', RoleCode: 'OFFICER1441', AppCode: 'OfficerHome' },
            { RoleId: 113, RoleName: 'Admin สน./สภ.', RoleCode: 'MNG_KK', AppCode: 'OfficerHome' },
            { RoleId: 114, RoleName: 'ครูไซเบอร์', RoleCode: 'CYBER_TRAINING', AppCode: 'OfficerHome' },
        ];

        if (url.includes('/role') && !url.includes('register')) {
            // Admin ตร. (ROOT) สามารถเลือก role อื่นได้ทั้งหมด
            if (currentUser.RoleCode === 'ROOT') {
                const rolesWithDefault = MOCK_ROLES.map(r => ({ ...r, IsDefault: r.RoleId === currentUser.RoleId }));
                res.end(success(rolesWithDefault));
            } else {
                // Return only the role that matches the current user
                const userRole = MOCK_ROLES.find(r => r.RoleId === currentUser.RoleId);
                res.end(success(userRole ? [{ ...userRole, IsDefault: true }] : [MOCK_ROLES[0]]));
            }
            return;
        }

        if (url.includes('getmenus') || url.includes('privilege/menu') || url.includes('user/menus')) {
            // Parse roleId from query string
            const urlObj = new URL(req.url, `http://localhost:${PORT}`);
            const roleId = parseInt(urlObj.searchParams.get('roleId') || '76', 10);
            const matchedRole = MOCK_ROLES.find(r => r.RoleId === roleId);
            const roleCode = matchedRole ? matchedRole.RoleCode : 'ROOT';

            // ===== LEGACY MENUS (จากระบบ production จริง — ไฟล์ 43) =====
            // Top-level (ทุกบทบาทเห็น)
            const topMenus = [
                { MODULE_ID: 1, MODULE_NAME: 'หน้าหลัก', MODULE_URL: 'officer/main-page', MODULE_PARENT_ID: 0, MODULE_CODE: 'MAIN', MODULE_ICON: 'fa fa-home', IS_ACTIVE: true },
                { MODULE_ID: 2, MODULE_NAME: 'สถานะภาพทางคดี (Dashboard)', MODULE_URL: 'officer/dashboard-officer', MODULE_PARENT_ID: 0, MODULE_CODE: 'DASHOFC', MODULE_ICON: 'fa fa-dashboard', IS_ACTIVE: true },
                { MODULE_ID: 3, MODULE_NAME: 'ค้นหาเรื่องรับแจ้ง', MODULE_URL: 'officer/search/case', MODULE_PARENT_ID: 0, MODULE_CODE: 'SEARCHCASE', MODULE_ICON: 'fa fa-search', IS_ACTIVE: true },
            ];

            // หมวด: เรื่องรับแจ้ง (ทุกบทบาทเห็น)
            const incomingReportMenus = [
                { MODULE_ID: 100, MODULE_NAME: 'เรื่องรับแจ้ง', MODULE_URL: '', MODULE_PARENT_ID: 0, MODULE_CODE: 'GRP_REPORT', MODULE_ICON: 'fa fa-folder-open', IS_ACTIVE: true },
                { MODULE_ID: 101, MODULE_NAME: 'คดี', MODULE_URL: '', MODULE_PARENT_ID: 100, MODULE_CODE: 'GRP_CASE', MODULE_ICON: 'fa fa-folder', IS_ACTIVE: true },
                { MODULE_ID: 102, MODULE_NAME: 'คดีออนไลน์', MODULE_URL: 'officer/task-admin', MODULE_PARENT_ID: 101, MODULE_CODE: 'CASEONLINE', MODULE_ICON: 'fa fa-globe', IS_ACTIVE: true },
                { MODULE_ID: 103, MODULE_NAME: 'คดีอาญาทั่วไป', MODULE_URL: 'officer/task-criminal', MODULE_PARENT_ID: 101, MODULE_CODE: 'CASECRIM', MODULE_ICON: 'fa fa-gavel', IS_ACTIVE: true },
                { MODULE_ID: 104, MODULE_NAME: 'คดีแพ่ง', MODULE_URL: 'officer/task-civil', MODULE_PARENT_ID: 101, MODULE_CODE: 'CASECIVIL', MODULE_ICON: 'fa fa-balance-scale', IS_ACTIVE: true },
                { MODULE_ID: 105, MODULE_NAME: 'คดีจาก สคบ.', MODULE_URL: 'officer/task-ocpb', MODULE_PARENT_ID: 101, MODULE_CODE: 'CASEOCPB', MODULE_ICON: 'fa fa-file', IS_ACTIVE: true },
                { MODULE_ID: 106, MODULE_NAME: 'คดี Cryptocurrency', MODULE_URL: 'officer/task-crypto', MODULE_PARENT_ID: 101, MODULE_CODE: 'CASECRYPTO', MODULE_ICON: 'fa fa-bitcoin', IS_ACTIVE: true },
                { MODULE_ID: 107, MODULE_NAME: 'คดีจาก ETDA', MODULE_URL: 'officer/task-etda', MODULE_PARENT_ID: 101, MODULE_CODE: 'CASEETDA', MODULE_ICON: 'fa fa-file-text', IS_ACTIVE: true },
                { MODULE_ID: 108, MODULE_NAME: 'ข้อมูลคดี ศทก.', MODULE_URL: 'officer/case-crime', MODULE_PARENT_ID: 100, MODULE_CODE: 'CRIMECIB', MODULE_ICON: 'fa fa-exclamation-triangle', IS_ACTIVE: true },
                { MODULE_ID: 109, MODULE_NAME: 'แจ้งเบาะแสคนร้าย', MODULE_URL: 'officer/case-report-criminal', MODULE_PARENT_ID: 100, MODULE_CODE: 'CLUECRM', MODULE_ICON: 'fa fa-user-secret', IS_ACTIVE: true },
                { MODULE_ID: 110, MODULE_NAME: 'แจ้งเบาะแส', MODULE_URL: 'officer/task-clue', MODULE_PARENT_ID: 100, MODULE_CODE: 'CLUE', MODULE_ICON: 'fa fa-bullhorn', IS_ACTIVE: true },
                { MODULE_ID: 111, MODULE_NAME: 'จำหน่าย', MODULE_URL: 'officer/task-dispose', MODULE_PARENT_ID: 100, MODULE_CODE: 'DISPOSE', MODULE_ICON: 'fa fa-trash', IS_ACTIVE: true },
                { MODULE_ID: 112, MODULE_NAME: 'บัญชีม้าแถว 1', MODULE_URL: 'officer/task-bank', MODULE_PARENT_ID: 100, MODULE_CODE: 'MULEBANK', MODULE_ICON: 'fa fa-credit-card', IS_ACTIVE: true },
                { MODULE_ID: 113, MODULE_NAME: 'task-hr03', MODULE_URL: 'officer/task-hr03', MODULE_PARENT_ID: 100, MODULE_CODE: 'HR03', MODULE_ICON: 'fa fa-file-o', IS_ACTIVE: true },
                { MODULE_ID: 114, MODULE_NAME: 'การรับแจ้งปลดระงับบัญชีธนาคาร', MODULE_URL: 'officer/task-release-account', MODULE_PARENT_ID: 100, MODULE_CODE: 'RELACCOUNT', MODULE_ICON: 'fa fa-unlock', IS_ACTIVE: true },
                { MODULE_ID: 115, MODULE_NAME: 'สถิติการรับแจ้งปลดระงับบัญชีธนาคาร', MODULE_URL: 'officer/task-release-suspension', MODULE_PARENT_ID: 100, MODULE_CODE: 'RELSUSPSTAT', MODULE_ICON: 'fa fa-bar-chart', IS_ACTIVE: true },
                { MODULE_ID: 116, MODULE_NAME: 'Case ID ที่ยังไม่ได้บันทึกการสืบสวน', MODULE_URL: 'officer/task-case-id', MODULE_PARENT_ID: 100, MODULE_CODE: 'CASEIDPEND', MODULE_ICON: 'fa fa-exclamation-circle', IS_ACTIVE: true },
                { MODULE_ID: 117, MODULE_NAME: 'สถานะหมาย', MODULE_URL: '', MODULE_PARENT_ID: 100, MODULE_CODE: 'GRP_NOTE', MODULE_ICON: 'fa fa-bookmark', IS_ACTIVE: true },
                { MODULE_ID: 118, MODULE_NAME: 'สถานะหมายทั่วไป', MODULE_URL: 'officer/task-note', MODULE_PARENT_ID: 117, MODULE_CODE: 'NOTENORM', MODULE_ICON: 'fa fa-bookmark-o', IS_ACTIVE: true },
                { MODULE_ID: 119, MODULE_NAME: 'สถานะหมาย H', MODULE_URL: 'officer/task-bankcaseid-h', MODULE_PARENT_ID: 117, MODULE_CODE: 'NOTEH', MODULE_ICON: 'fa fa-bookmark', IS_ACTIVE: true },
            ];

            // หมวด: การจัดการคดี (ทุกบทบาทเห็น)
            const caseManagementMenus = [
                { MODULE_ID: 200, MODULE_NAME: 'การจัดการคดี', MODULE_URL: '', MODULE_PARENT_ID: 0, MODULE_CODE: 'GRP_CASEMNG', MODULE_ICON: 'fa fa-cogs', IS_ACTIVE: true },
                { MODULE_ID: 201, MODULE_NAME: 'อัตลักษณ์ทางคดี', MODULE_URL: 'officer/case-entity', MODULE_PARENT_ID: 200, MODULE_CODE: 'ENTITY', MODULE_ICON: 'fa fa-fingerprint', IS_ACTIVE: true },
                { MODULE_ID: 202, MODULE_NAME: 'ความเชื่อมโยงคดี', MODULE_URL: 'officer/case-info-check', MODULE_PARENT_ID: 200, MODULE_CODE: 'CASELINK', MODULE_ICON: 'fa fa-link', IS_ACTIVE: true },
                { MODULE_ID: 203, MODULE_NAME: 'ความเชื่อมโยงอัตลักษณ์', MODULE_URL: 'officer/entity-link', MODULE_PARENT_ID: 200, MODULE_CODE: 'ENTITYLINK', MODULE_ICON: 'fa fa-share-alt', IS_ACTIVE: true },
                { MODULE_ID: 204, MODULE_NAME: 'ข้อมูลจาก สคบ.', MODULE_URL: 'officer/case-ocpb', MODULE_PARENT_ID: 200, MODULE_CODE: 'OCPBDATA', MODULE_ICON: 'fa fa-file', IS_ACTIVE: true },
                { MODULE_ID: 205, MODULE_NAME: 'ปรับโอนเคสไอดี', MODULE_URL: 'officer/transfercase', MODULE_PARENT_ID: 200, MODULE_CODE: 'TRANSFER', MODULE_ICON: 'fa fa-exchange', IS_ACTIVE: true },
                { MODULE_ID: 206, MODULE_NAME: 'ตรวจสอบ/บันทึกข้อมูลสถานีที่สะดวก', MODULE_URL: 'officer/verify-case-page', MODULE_PARENT_ID: 200, MODULE_CODE: 'VERIFYCASE', MODULE_ICON: 'fa fa-map-marker', IS_ACTIVE: true },
                { MODULE_ID: 207, MODULE_NAME: 'สถานะการปิด URL', MODULE_URL: 'officer/url-status', MODULE_PARENT_ID: 200, MODULE_CODE: 'URLSTATUS', MODULE_ICON: 'fa fa-ban', IS_ACTIVE: true },
                { MODULE_ID: 208, MODULE_NAME: 'สถานะการแนบไฟล์เจ้าหน้าที่', MODULE_URL: 'officer/case-attachment-check', MODULE_PARENT_ID: 200, MODULE_CODE: 'ATTACHCHK', MODULE_ICON: 'fa fa-paperclip', IS_ACTIVE: true },
                { MODULE_ID: 209, MODULE_NAME: 'ค้นหาคดี ศทก.', MODULE_URL: 'officer/case-crime-search', MODULE_PARENT_ID: 200, MODULE_CODE: 'CRIMESRCH', MODULE_ICON: 'fa fa-search', IS_ACTIVE: true },
                { MODULE_ID: 210, MODULE_NAME: 'ข้อมูล Numering Audit', MODULE_URL: 'officer/numering-audit', MODULE_PARENT_ID: 200, MODULE_CODE: 'NUMAUDIT', MODULE_ICON: 'fa fa-list-ol', IS_ACTIVE: true },
                { MODULE_ID: 211, MODULE_NAME: 'ข้อมูลจาก ETDA', MODULE_URL: 'officer/case-etda', MODULE_PARENT_ID: 200, MODULE_CODE: 'ETDADATA', MODULE_ICON: 'fa fa-file-text', IS_ACTIVE: true },
                { MODULE_ID: 213, MODULE_NAME: 'รวมคดี', MODULE_URL: 'officer/merge-case-admin', MODULE_PARENT_ID: 200, MODULE_CODE: 'MERGECASE', MODULE_ICON: 'fa fa-compress', IS_ACTIVE: true },
                { MODULE_ID: 214, MODULE_NAME: 'ค้นหาข้อมูลจาก CDR', MODULE_URL: 'officer/cdr-list', MODULE_PARENT_ID: 200, MODULE_CODE: 'CDRDATA', MODULE_ICON: 'fa fa-phone', IS_ACTIVE: true },
            ];

            // หมวด: CFR (เฉพาะ ROOT และ สืบบริหาร เท่านั้น)
            const cfrMenus = [
                { MODULE_ID: 212, MODULE_NAME: 'ค้นหาข้อมูลจาก CFR', MODULE_URL: 'officer/cfr-search-list', MODULE_PARENT_ID: 200, MODULE_CODE: 'CFRSEARCH', MODULE_ICON: 'fa fa-money', IS_ACTIVE: true },
            ];

            // หมวด: การมอบหมายงานและบุคลากร (MNG_BK, ROOT — บางส่วน OFFICER เห็น)
            const taskAssignmentMenus = [
                { MODULE_ID: 300, MODULE_NAME: 'การมอบหมายงานและบุคลากร', MODULE_URL: '', MODULE_PARENT_ID: 0, MODULE_CODE: 'GRP_ASSIGN', MODULE_ICON: 'fa fa-users', IS_ACTIVE: true },
                { MODULE_ID: 301, MODULE_NAME: 'มอบหมายงาน', MODULE_URL: 'officer/assign-task', MODULE_PARENT_ID: 300, MODULE_CODE: 'ASSIGNTASK', MODULE_ICON: 'fa fa-hand-o-right', IS_ACTIVE: true },
                { MODULE_ID: 302, MODULE_NAME: 'Case ID ที่รับผิดชอบ', MODULE_URL: 'officer/case-personal', MODULE_PARENT_ID: 300, MODULE_CODE: 'CASEOWNER', MODULE_ICON: 'fa fa-user', IS_ACTIVE: true },
                { MODULE_ID: 303, MODULE_NAME: 'ทบทวนการมอบหมายคดี', MODULE_URL: 'officer/argue', MODULE_PARENT_ID: 300, MODULE_CODE: 'ARGUE', MODULE_ICON: 'fa fa-refresh', IS_ACTIVE: true },
                { MODULE_ID: 304, MODULE_NAME: 'จำนวนประเด็นที่ได้รับมอบหมายทั้งหมด', MODULE_URL: 'officer/task-issue/count', MODULE_PARENT_ID: 300, MODULE_CODE: 'ISSUECOUNT', MODULE_ICON: 'fa fa-calculator', IS_ACTIVE: true },
                { MODULE_ID: 305, MODULE_NAME: 'งานที่มอบหมาย', MODULE_URL: '', MODULE_PARENT_ID: 300, MODULE_CODE: 'GRP_TASKOUT', MODULE_ICON: 'fa fa-share', IS_ACTIVE: true },
                { MODULE_ID: 306, MODULE_NAME: 'ประเด็นการสอบสวน/สืบสวน', MODULE_URL: 'officer/task-issue/assign', MODULE_PARENT_ID: 305, MODULE_CODE: 'ISSUEASSIGN', MODULE_ICON: 'fa fa-tasks', IS_ACTIVE: true },
                { MODULE_ID: 307, MODULE_NAME: 'ส่งหมายเรียก', MODULE_URL: 'officer/doc-summons', MODULE_PARENT_ID: 305, MODULE_CODE: 'SUMMONS', MODULE_ICON: 'fa fa-envelope', IS_ACTIVE: true },
                { MODULE_ID: 308, MODULE_NAME: 'หมายสอบปากคำธนาคาร', MODULE_URL: 'officer/task-issue-bank', MODULE_PARENT_ID: 305, MODULE_CODE: 'BANKISSUE', MODULE_ICON: 'fa fa-bank', IS_ACTIVE: true },
                { MODULE_ID: 309, MODULE_NAME: 'หมายสอบปากคำผู้ให้บริการเครือข่าย', MODULE_URL: 'officer/task-issue/assign', MODULE_PARENT_ID: 305, MODULE_CODE: 'NETISSUE', MODULE_ICON: 'fa fa-wifi', IS_ACTIVE: true },
                { MODULE_ID: 310, MODULE_NAME: 'คดีที่เจ้าหน้าที่รับผิดชอบ', MODULE_URL: 'officer/all-task', MODULE_PARENT_ID: 300, MODULE_CODE: 'ALLTASK', MODULE_ICON: 'fa fa-list', IS_ACTIVE: true },
                { MODULE_ID: 311, MODULE_NAME: 'งานที่ได้รับมอบหมาย', MODULE_URL: 'officer/task-issue/my-task', MODULE_PARENT_ID: 300, MODULE_CODE: 'MYTASKISSUE', MODULE_ICON: 'fa fa-inbox', IS_ACTIVE: true },
                { MODULE_ID: 312, MODULE_NAME: 'อนุมัติเจ้าหน้าที่', MODULE_URL: 'officer/personal-approve', MODULE_PARENT_ID: 300, MODULE_CODE: 'PERSAPPROVE', MODULE_ICON: 'fa fa-check-circle', IS_ACTIVE: true },
            ];

            // หมวด: รายงานและสถิติ (ทุกบทบาทเห็น)
            const reportStatsMenus = [
                { MODULE_ID: 400, MODULE_NAME: 'รายงานและสถิติ', MODULE_URL: '', MODULE_PARENT_ID: 0, MODULE_CODE: 'GRP_REPORT_STAT', MODULE_ICON: 'fa fa-bar-chart', IS_ACTIVE: true },
                { MODULE_ID: 401, MODULE_NAME: 'รายงานแบบประเมินความพึงพอใจ', MODULE_URL: 'officer/evaluation-report/case', MODULE_PARENT_ID: 400, MODULE_CODE: 'EVALREPORT', MODULE_ICON: 'fa fa-star', IS_ACTIVE: true },
                { MODULE_ID: 402, MODULE_NAME: 'รายงานอัตลักษณ์ของคดี (Entity)', MODULE_URL: 'officer/report-entity', MODULE_PARENT_ID: 400, MODULE_CODE: 'RPTENTITY', MODULE_ICON: 'fa fa-id-badge', IS_ACTIVE: true },
                { MODULE_ID: 403, MODULE_NAME: 'รายงานผลการบันทึกรายงานการสืบสวน', MODULE_URL: 'officer/report-case-investigate-record', MODULE_PARENT_ID: 400, MODULE_CODE: 'RPTINVEST', MODULE_ICON: 'fa fa-file-text', IS_ACTIVE: true },
                { MODULE_ID: 404, MODULE_NAME: 'รายการบัญชีคนร้ายแถว 1', MODULE_URL: 'officer/report-criminal-bank-account', MODULE_PARENT_ID: 400, MODULE_CODE: 'RPTCRIMBANK', MODULE_ICON: 'fa fa-credit-card', IS_ACTIVE: true },
                { MODULE_ID: 405, MODULE_NAME: 'รายงานการวิเคราะห์', MODULE_URL: 'officer/report-analyze', MODULE_PARENT_ID: 400, MODULE_CODE: 'RPTANALYZE', MODULE_ICON: 'fa fa-pie-chart', IS_ACTIVE: true },
                { MODULE_ID: 406, MODULE_NAME: 'สถิติการรับแจ้งคดีออนไลน์รายวัน/รายชั่วโมง', MODULE_URL: 'officer/report-time-incident', MODULE_PARENT_ID: 400, MODULE_CODE: 'STATTIMEINC', MODULE_ICON: 'fa fa-clock-o', IS_ACTIVE: true },
                { MODULE_ID: 407, MODULE_NAME: 'สถิติการรับแจ้งคดีออนไลน์และจำนวนผู้เสียหาย', MODULE_URL: 'officer/dashboard-officer', MODULE_PARENT_ID: 400, MODULE_CODE: 'STATVICTIM', MODULE_ICON: 'fa fa-users', IS_ACTIVE: true },
                { MODULE_ID: 408, MODULE_NAME: 'ประเภทคดีแบ่งตามเพศและอายุ', MODULE_URL: 'officer/dashboard-sn', MODULE_PARENT_ID: 400, MODULE_CODE: 'STATGENDER', MODULE_ICON: 'fa fa-venus-mars', IS_ACTIVE: true },
                { MODULE_ID: 409, MODULE_NAME: 'สถิติประเด็นการสืบสวนและสถานะคดี', MODULE_URL: 'officer/dashboard-pgs', MODULE_PARENT_ID: 400, MODULE_CODE: 'STATISSUE', MODULE_ICON: 'fa fa-area-chart', IS_ACTIVE: true },
                { MODULE_ID: 410, MODULE_NAME: 'ธนาคารกับข้อมูลความเสียหาย', MODULE_URL: 'officer/dashboard-channel', MODULE_PARENT_ID: 400, MODULE_CODE: 'STATBANK', MODULE_ICON: 'fa fa-bank', IS_ACTIVE: true },
                { MODULE_ID: 411, MODULE_NAME: 'สถิติการประชาสัมพันธ์สร้างภูมิคุ้มกัน', MODULE_URL: 'officer/dashboard-chat', MODULE_PARENT_ID: 400, MODULE_CODE: 'STATPR', MODULE_ICON: 'fa fa-comments', IS_ACTIVE: true },
                { MODULE_ID: 412, MODULE_NAME: 'Cyber Support Analytics', MODULE_URL: 'officer/dashboard-chat-officer', MODULE_PARENT_ID: 400, MODULE_CODE: 'CYBERSUPPORT', MODULE_ICON: 'fa fa-headphones', IS_ACTIVE: true },
                { MODULE_ID: 413, MODULE_NAME: 'บัญชีใช้ซ้ำ', MODULE_URL: 'officer/checking-account', MODULE_PARENT_ID: 400, MODULE_CODE: 'REUSEACCT', MODULE_ICON: 'fa fa-repeat', IS_ACTIVE: true },
                { MODULE_ID: 414, MODULE_NAME: 'วิเคราะห์ความสัมพันธ์อัตลักษณ์', MODULE_URL: 'officer/task_admin-test', MODULE_PARENT_ID: 400, MODULE_CODE: 'LINKCHART', MODULE_ICON: 'fa fa-project-diagram', IS_ACTIVE: true },
                { MODULE_ID: 415, MODULE_NAME: 'สถิติการรับแจ้งความ (ICCS)', MODULE_URL: 'officer/issue-detail-new-iccs-list', MODULE_PARENT_ID: 400, MODULE_CODE: 'STATICCS', MODULE_ICON: 'fa fa-list-alt', IS_ACTIVE: true },
                { MODULE_ID: 416, MODULE_NAME: 'สถิติส่วนโทรศัพท์ และ VOIP', MODULE_URL: 'officer/information-phone', MODULE_PARENT_ID: 400, MODULE_CODE: 'STATPHONE', MODULE_ICON: 'fa fa-phone', IS_ACTIVE: true },
                { MODULE_ID: 417, MODULE_NAME: 'สถานะคดีทั้งหมด (Dashboard)', MODULE_URL: 'officer/dashboard-all-status', MODULE_PARENT_ID: 400, MODULE_CODE: 'DASHALLSTAT', MODULE_ICON: 'fa fa-th-large', IS_ACTIVE: true },
                { MODULE_ID: 418, MODULE_NAME: 'ข้อมูลช่องทางติดต่อคนร้าย (Dashboard)', MODULE_URL: 'officer/dashboard-channel', MODULE_PARENT_ID: 400, MODULE_CODE: 'DASHCHANNEL', MODULE_ICON: 'fa fa-share-alt', IS_ACTIVE: true },
                { MODULE_ID: 419, MODULE_NAME: 'ข้อมูลบัญชีแถว 1', MODULE_URL: 'officer/task-bank', MODULE_PARENT_ID: 400, MODULE_CODE: 'BANKROW1', MODULE_ICON: 'fa fa-database', IS_ACTIVE: true },
            ];

            // หมวด: การสื่อสารและแจ้งปัญหา (ทุกบทบาทเห็น)
            const communicationMenus = [
                { MODULE_ID: 500, MODULE_NAME: 'การสื่อสารและแจ้งปัญหา', MODULE_URL: '', MODULE_PARENT_ID: 0, MODULE_CODE: 'GRP_COMM', MODULE_ICON: 'fa fa-comments', IS_ACTIVE: true },
                { MODULE_ID: 501, MODULE_NAME: 'ประชาชนแจ้งปัญหา', MODULE_URL: 'officer/problem-list', MODULE_PARENT_ID: 500, MODULE_CODE: 'PROBLEM', MODULE_ICON: 'fa fa-exclamation-circle', IS_ACTIVE: true },
                { MODULE_ID: 502, MODULE_NAME: 'ส่งข้อความหลายรายการ', MODULE_URL: 'officer/reply-messages', MODULE_PARENT_ID: 500, MODULE_CODE: 'REPLYMSG', MODULE_ICON: 'fa fa-envelope', IS_ACTIVE: true },
                { MODULE_ID: 503, MODULE_NAME: 'ข้อมูลการแจ้งคดีซ้ำ', MODULE_URL: 'officer/monitor-submitcase-duplicate', MODULE_PARENT_ID: 500, MODULE_CODE: 'DUPCASE', MODULE_ICON: 'fa fa-copy', IS_ACTIVE: true },
                { MODULE_ID: 504, MODULE_NAME: 'เคสที่ยังไม่ได้บันทึกอัตลักษณ์', MODULE_URL: 'officer/caseNotHaveEntity', MODULE_PARENT_ID: 500, MODULE_CODE: 'NOENTITY', MODULE_ICON: 'fa fa-question-circle', IS_ACTIVE: true },
                { MODULE_ID: 505, MODULE_NAME: 'Case AOC ที่บันทึกเข้าระบบไม่ได้', MODULE_URL: 'officer/case-aoc-error', MODULE_PARENT_ID: 500, MODULE_CODE: 'AOCERROR', MODULE_ICON: 'fa fa-warning', IS_ACTIVE: true },
            ];

            // หมวด: คู่มือ เอกสารประกอบคดีและสื่อการสอน (ทุกบทบาทเห็น)
            const manualMenus = [
                { MODULE_ID: 600, MODULE_NAME: 'คู่มือ เอกสารประกอบคดีและสื่อการสอน', MODULE_URL: '', MODULE_PARENT_ID: 0, MODULE_CODE: 'GRP_MANUAL', MODULE_ICON: 'fa fa-book', IS_ACTIVE: true },
                { MODULE_ID: 601, MODULE_NAME: 'ตัวอย่างคำให้การผู้เสียหายคดีออนไลน์', MODULE_URL: 'officer/case-manual', MODULE_PARENT_ID: 600, MODULE_CODE: 'CASEMANUAL', MODULE_ICON: 'fa fa-file-text', IS_ACTIVE: true },
                { MODULE_ID: 602, MODULE_NAME: 'เอกสารประกอบคดี', MODULE_URL: 'officer/document-acsc-status', MODULE_PARENT_ID: 600, MODULE_CODE: 'DOCACSC', MODULE_ICON: 'fa fa-file-pdf-o', IS_ACTIVE: true },
                { MODULE_ID: 603, MODULE_NAME: 'คู่มือและสื่อการสอน', MODULE_URL: 'officer/manual', MODULE_PARENT_ID: 600, MODULE_CODE: 'MANUAL', MODULE_ICON: 'fa fa-graduation-cap', IS_ACTIVE: true },
                { MODULE_ID: 604, MODULE_NAME: 'คลังความรู้', MODULE_URL: 'officer/knowledge-base', MODULE_PARENT_ID: 600, MODULE_CODE: 'KNOWBASE', MODULE_ICON: 'fa fa-lightbulb-o', IS_ACTIVE: true },
            ];

            // Top-level standalone (ทุกบทบาทเห็น)
            const exportTaxMenus = [
                { MODULE_ID: 700, MODULE_NAME: 'Export แบบเลือกฟิลด์', MODULE_URL: 'officer/export-custom-field', MODULE_PARENT_ID: 0, MODULE_CODE: 'EXPORTFIELD', MODULE_ICON: 'fa fa-download', IS_ACTIVE: true },
                { MODULE_ID: 701, MODULE_NAME: 'ค้นหาข้อมูลสรรพากร', MODULE_URL: 'officer/rd-search', MODULE_PARENT_ID: 0, MODULE_CODE: 'RDSEARCH', MODULE_ICON: 'fa fa-search', IS_ACTIVE: true },
                { MODULE_ID: 702, MODULE_NAME: 'ข้อมูลการตรวจสอบกับสรรพากร', MODULE_URL: 'officer/rd-search-list', MODULE_PARENT_ID: 0, MODULE_CODE: 'RDLIST', MODULE_ICON: 'fa fa-list', IS_ACTIVE: true },
            ];

            // หมวด: TDEX (ทุกบทบาทเห็น)
            const tdexMenus = [
                { MODULE_ID: 800, MODULE_NAME: 'TDEX', MODULE_URL: '', MODULE_PARENT_ID: 0, MODULE_CODE: 'GRP_TDEX', MODULE_ICON: 'fa fa-exchange', IS_ACTIVE: true },
                { MODULE_ID: 801, MODULE_NAME: 'รายการข้อมูลคดีในระบบ', MODULE_URL: 'officer/tdex/request-list', MODULE_PARENT_ID: 800, MODULE_CODE: 'TDEXREQ', MODULE_ICON: 'fa fa-list', IS_ACTIVE: true },
                { MODULE_ID: 802, MODULE_NAME: 'คำขอข้อมูลผู้ลงทะเบียน/CDR', MODULE_URL: 'officer/tdex/kyc', MODULE_PARENT_ID: 800, MODULE_CODE: 'TDEXKYC', MODULE_ICON: 'fa fa-id-card', IS_ACTIVE: true },
                { MODULE_ID: 803, MODULE_NAME: 'คำขอข้อมูลผู้ลงทะเบียน/CDR (สืบสวนขยายผล)', MODULE_URL: 'officer/tdex/kyc-nocase', MODULE_PARENT_ID: 800, MODULE_CODE: 'TDEXKYCNC', MODULE_ICON: 'fa fa-id-card-o', IS_ACTIVE: true },
                { MODULE_ID: 804, MODULE_NAME: 'คำขอระงับเบอร์โทรศัพท์', MODULE_URL: 'officer/tdex/suspend', MODULE_PARENT_ID: 800, MODULE_CODE: 'TDEXSUSP', MODULE_ICON: 'fa fa-ban', IS_ACTIVE: true },
                { MODULE_ID: 805, MODULE_NAME: 'คำขอปลดระงับเบอร์โทรศัพท์', MODULE_URL: 'officer/tdex/unsuspend', MODULE_PARENT_ID: 800, MODULE_CODE: 'TDEXUNSUSP', MODULE_ICON: 'fa fa-unlock', IS_ACTIVE: true },
            ];

            // Role-specific menus — grouped under parent categories
            const officerMenus = [
                // Parent group: เครื่องมือสอบสวน
                { MODULE_ID: 19, MODULE_NAME: 'เครื่องมือสอบสวน', MODULE_URL: '', MODULE_PARENT_ID: 0, MODULE_CODE: 'GRP_INVEST', MODULE_ICON: 'fa fa-briefcase', IS_ACTIVE: true },
                { MODULE_ID: 21, MODULE_NAME: 'ผู้ช่วยกฎหมาย', MODULE_URL: 'officer/legal-aid', MODULE_PARENT_ID: 19, MODULE_CODE: 'LEGALAID', MODULE_ICON: 'fa fa-gavel', IS_ACTIVE: true },
                { MODULE_ID: 22, MODULE_NAME: 'จัดทำเอกสาร', MODULE_URL: 'officer/document-drafting', MODULE_PARENT_ID: 19, MODULE_CODE: 'DOCDRAFT', MODULE_ICON: 'fa fa-file-word-o', IS_ACTIVE: true },
            ];

            const analystMenus = [
                // Parent group: เครื่องมือสืบสวน
                { MODULE_ID: 29, MODULE_NAME: 'เครื่องมือสืบสวน', MODULE_URL: '', MODULE_PARENT_ID: 0, MODULE_CODE: 'GRP_ANAL', MODULE_ICON: 'fa fa-search', IS_ACTIVE: true },
                { MODULE_ID: 30, MODULE_NAME: 'เชื่อมโยงเครือข่าย', MODULE_URL: 'officer/network-intel', MODULE_PARENT_ID: 29, MODULE_CODE: 'NETINTEL', MODULE_ICON: 'fa fa-sitemap', IS_ACTIVE: true },
                { MODULE_ID: 31, MODULE_NAME: 'เส้นทางการเงิน', MODULE_URL: 'officer/financial-trail', MODULE_PARENT_ID: 29, MODULE_CODE: 'FINTRAIL', MODULE_ICON: 'fa fa-money', IS_ACTIVE: true },
                { MODULE_ID: 32, MODULE_NAME: 'สืบสวน OSINT', MODULE_URL: 'officer/osint-investigation', MODULE_PARENT_ID: 29, MODULE_CODE: 'OSINT', MODULE_ICON: 'fa fa-globe', IS_ACTIVE: true },
            ];

            const mngMenus = [
                // Parent group: บริหารจัดการ
                { MODULE_ID: 39, MODULE_NAME: 'บริหารจัดการ', MODULE_URL: '', MODULE_PARENT_ID: 0, MODULE_CODE: 'GRP_MNG', MODULE_ICON: 'fa fa-users', IS_ACTIVE: true },
                { MODULE_ID: 40, MODULE_NAME: 'มอบหมายคดี', MODULE_URL: 'officer/case-assignment', MODULE_PARENT_ID: 39, MODULE_CODE: 'CASEASSIGN', MODULE_ICON: 'fa fa-share', IS_ACTIVE: true },
                { MODULE_ID: 41, MODULE_NAME: 'ศูนย์บัญชาการป้องกัน', MODULE_URL: 'officer/prevention-center', MODULE_PARENT_ID: 39, MODULE_CODE: 'PREVENT', MODULE_ICON: 'fa fa-shield', IS_ACTIVE: true },
            ];

            const execMenus = [
                // Parent group: ภาพรวมผู้บริหาร
                { MODULE_ID: 49, MODULE_NAME: 'ภาพรวมผู้บริหาร', MODULE_URL: '', MODULE_PARENT_ID: 0, MODULE_CODE: 'GRP_EXEC', MODULE_ICON: 'fa fa-line-chart', IS_ACTIVE: true },
                { MODULE_ID: 50, MODULE_NAME: 'Executive Insight', MODULE_URL: 'officer/executive-insight', MODULE_PARENT_ID: 49, MODULE_CODE: 'EXECINSIGHT', MODULE_ICON: 'fa fa-bar-chart', IS_ACTIVE: true },
                { MODULE_ID: 51, MODULE_NAME: 'วิเคราะห์ผู้เสียหาย', MODULE_URL: 'officer/victim-profiling', MODULE_PARENT_ID: 49, MODULE_CODE: 'VICTIMPROF', MODULE_ICON: 'fa fa-user-circle', IS_ACTIVE: true },
                { MODULE_ID: 52, MODULE_NAME: 'เตือนภัยล่วงหน้า', MODULE_URL: 'officer/trend-radar', MODULE_PARENT_ID: 49, MODULE_CODE: 'TRENDRADAR', MODULE_ICON: 'fa fa-warning', IS_ACTIVE: true },
                { MODULE_ID: 53, MODULE_NAME: 'ศูนย์บัญชาการป้องกัน', MODULE_URL: 'officer/prevention-center', MODULE_PARENT_ID: 49, MODULE_CODE: 'PREVENT2', MODULE_ICON: 'fa fa-shield', IS_ACTIVE: true },
            ];

            const adminMenus = [
                { MODULE_ID: 60, MODULE_NAME: 'AI Admin Panel', MODULE_URL: 'officer/ai-admin', MODULE_PARENT_ID: 0, MODULE_CODE: 'AIADMIN', MODULE_ICON: 'fa fa-cogs', IS_ACTIVE: true },
            ];

            let menus = [...topMenus];
            // TODO: 8 role ใหม่ (ADMIN_ACSC, ROOTTRAIN, ADMIN_BCH, MNG_CCIB, OFFICER_ACSC,
            // MNG_REGION, OFFICER1441, MNG_KK) ยังไม่ได้กำหนด scope เมนูละเอียด รอคำสั่งเพิ่มเติม
            // — ตอนนี้ตกไปที่ default เห็นแค่เมนูพื้นฐาน topMenus
            switch (roleCode) {
                case 'OFFICER':
                    menus = [...topMenus, ...incomingReportMenus, ...caseManagementMenus, ...taskAssignmentMenus, ...reportStatsMenus, ...communicationMenus, ...manualMenus, ...exportTaxMenus, ...tdexMenus, ...officerMenus];
                    break;
                case 'OFFICER_ANALYST':
                    menus = [...topMenus, ...incomingReportMenus, ...caseManagementMenus, ...taskAssignmentMenus, ...reportStatsMenus, ...communicationMenus, ...manualMenus, ...exportTaxMenus, ...tdexMenus, ...analystMenus];
                    break;
                case 'MNG_BK':
                    menus = [...topMenus, ...incomingReportMenus, ...caseManagementMenus, ...taskAssignmentMenus, ...reportStatsMenus, ...communicationMenus, ...manualMenus, ...exportTaxMenus, ...tdexMenus, ...analystMenus, ...mngMenus];
                    break;
                case 'EXECUTIVE':
                    menus = [...topMenus, ...incomingReportMenus, ...reportStatsMenus, ...manualMenus, ...execMenus];
                    break;
                case 'INVEST_EXEC': {
                    // สืบบริหาร = เหมือน ROOT ทุกอย่าง ยกเว้นโอนคดีไม่ได้ (MODULE_ID 205 = ปรับโอนเคสไอดี)
                    const caseManagementMenusNoTransfer = caseManagementMenus.filter(m => m.MODULE_ID !== 205);
                    menus = [...topMenus, ...incomingReportMenus, ...caseManagementMenusNoTransfer, ...cfrMenus, ...taskAssignmentMenus, ...reportStatsMenus, ...communicationMenus, ...manualMenus, ...exportTaxMenus, ...tdexMenus, ...officerMenus, ...analystMenus, ...mngMenus, ...execMenus, ...adminMenus];
                    break;
                }
                case 'CYBER_TRAINING':
                    // ครูไซเบอร์ — หน้า main-page แสดง <app-cyber-training> แทน layout ปกติ ไม่ต้องมีเมนูเพิ่ม
                    menus = [...topMenus];
                    break;
                case 'ROOT':
                    menus = [...topMenus, ...incomingReportMenus, ...caseManagementMenus, ...cfrMenus, ...taskAssignmentMenus, ...reportStatsMenus, ...communicationMenus, ...manualMenus, ...exportTaxMenus, ...tdexMenus, ...officerMenus, ...analystMenus, ...mngMenus, ...execMenus, ...adminMenus];
                    break;
            }

            console.log(`  [Menu] roleId=${roleId} roleCode=${roleCode} → ${menus.length} items`);
            res.end(success(menus));
            return;
        }
        // CmsPersonal
        if (url.includes('cmspersonal')) {
            res.end(success({
                PERSONAL_ID: 1, FULL_NAME: 'Admin Demo', ORGANIZE_ID: 1,
                ORGANIZE_CODE_LEV2: 3527, ORGANIZE_CODE_LEV3: 3528, ORGANIZE_CODE_LEV4: 0
            }));
            return;
        }

        if (url.includes('/bpmprocinst/') && !url.includes('log') && !url.includes('attachment') && !url.includes('workflow')) {
            const idMatch = req.url.match(/\/(\d+)/);
            const instId = idMatch ? +idMatch[1] : null;
            const mockCase = MOCK_CASE_DATA.find(c => c.InstId === instId) || MOCK_CASE_DATA[0];
            res.end(success(buildBpmProcInst(mockCase)));
            return;
        }

        // ========== BpmWorkflowTask (case list) ==========
        // Matches: BpmProcInst/workflow/task-list, BpmProcInst/workflow/task-list-new-ccib,
        // BpmProcInst/workflow/task-list/officer — all paginated list endpoints that must
        // return { Data, TotalCount } for DevExtreme's remote paging (E4021 otherwise).
        if (url.includes('bpmworkflow') || url.includes('workflow/task')) {
            const params = body ? JSON.parse(body) : {};
            const offset = params.Offset || 0;
            const length = params.Length || 10;
            const searchText = (params.CposText || '').toUpperCase();
            let filtered = MOCK_CASE_DATA;
            if (searchText) {
                filtered = filtered.filter(c =>
                    (c.TrackingCode || '').toUpperCase().includes(searchText) ||
                    (c.Ext5 || '').toUpperCase().includes(searchText) ||
                    (c.OptionalData || '').toUpperCase().includes(searchText)
                );
            }
            if (params.StatusCode) {
                filtered = filtered.filter(c => c.StatusCode === params.StatusCode);
            }
            const page = filtered.slice(offset, offset + length);
            res.end(success({ Data: page, TotalCount: filtered.length }));
            return;
        }

        // ========== CmsOnlineCaseInfo (case info by ID) ==========
        if (url.includes('cmsonlinecaseinfo/getbycaseid')) {
            const idMatch = req.url.match(/\/(\d+)/);
            const caseId = idMatch ? +idMatch[1] : null;
            const mockCase = MOCK_CASE_DATA.find(c => c.InstId === caseId) || MOCK_CASE_DATA[0];
            res.end(success(buildCaseInfo(mockCase)));
            return;
        }

        // ========== CmsOnlineCaseInfo search/relation ==========
        if (url.includes('cmsonlinecaseinfo') && url.includes('relation')) {
            // Find the case by ID from URL, then return related cases (same CaseTypeName)
            const idMatch = req.url.match(/\/(\d+)\/relation/);
            const caseId = idMatch ? +idMatch[1] : null;
            const sourceCase = caseId ? MOCK_CASE_DATA.find(c => c.InstId === caseId) : null;

            if (sourceCase) {
                const relatedCases = MOCK_CASE_DATA
                    .filter(c => c.CaseTypeName === sourceCase.CaseTypeName && c.InstId !== sourceCase.InstId)
                    .slice(0, 8)
                    .map(c => ({
                        INST_ID: c.InstId,
                        TRACKING_CODE: c.TrackingCode,
                        CASE_TYPE_NAME: c.CaseTypeName,
                        STATUS_NAME: c.StatusName,
                        ORG_NAME: c.OrganizeAbbr || '',
                        CREATE_DATE: c.CreateDate,
                        ENTITY_TYPE: 'CASE_TYPE',
                        ENTITY_IDENTITY: c.CaseTypeName,
                        RELATION_COUNT: 1
                    }));
                res.end(success({ Data: relatedCases, TotalCount: relatedCases.length }));
            } else {
                res.end(success({ Data: [], TotalCount: 0 }));
            }
            return;
        }

        // ========== Bank ref ==========
        if (url.includes('bankref') || url.includes('bpmfreezeaccount')) {
            res.end(success([
                { BANK_NAME: 'ธนาคารกสิกรไทย', BANK_ACCOUNT_NO: 'xxx-x-x8834-x', FREEZE_ACT_DATE: '2026-05-16', ACCOUNT_NAME: 'นาย ก.', BANK_ACCOUNT_TYPE: 'ออมทรัพย์', FREEZE_STATUS: 'อายัดแล้ว' }
            ]));
            return;
        }

        // ========== Case money ==========
        if (url.includes('casemoney')) {
            res.end(success([
                { CASE_MONEY_CHANNEL_TYPE: 'T', BANK_TRANSFER_DATE: '2026-05-15', CASE_MONEY_AMOUNT: '350000', CASE_MONEY_BANK_TRANFER: 'T' }
            ]));
            return;
        }

        // ========== Location ==========
        if (url.includes('location')) {
            res.end(success([{ CASE_LOCATION_PROVINCE_ID: 10, PROVINCE_NAME_THA: 'กรุงเทพมหานคร' }]));
            return;
        }

        // ========== Questionnaire ==========
        // Real endpoint is CmsOnlineCaseInfo/casequestionate/{id} ("questionate", not
        // "questionare") — the old check only matched the misspelled version, so this request
        // fell through to no handler and the frontend's (questionare || []).map() blew up on
        // whatever came back, which aborted setData() before overviewData ever got populated
        // (that's why the case detail page showed blank fields / "Invalid Date").
        if (url.includes('questionare') || url.includes('questionate')) {
            res.end(success([]));
            return;
        }

        // ========== Channel ==========
        if (url.includes('casechannel') || url.includes('channel')) {
            res.end(success({
                CASE_CHANNEL: [{ CHANNEL_NAME: 'Facebook', SHOW_TEXT: '<b>Facebook:</b> เพจร้านค้าปลอม', CHANEL_FACEBOOK: true, CHANNEL_ID: 3 }],
                CASE_CRIMINAL: [{ CRIMINAL_FIRSTNAME: 'ไม่ทราบ', CRIMINAL_LASTNAME: '', CRIMINAL_TEL: '09x-xxx-4521', CRIMINAL_NOTE: 'ติดต่อผ่าน Facebook' }],
                CASE_CRIMINAL_MEET: [{ MEET_ONLINE: true }]
            }));
            return;
        }

        // ========== FormConfig ==========
        if (url.includes('formconfig') || url.includes('form-config')) {
            res.end(success({ formCode: 'online_case', formVersion: '1.0', formType: 'online', apiLoad: false }));
            return;
        }

        // ========== History ==========
        if (url.includes('history') || (url.includes('bpmprocinst') && url.includes('log'))) {
            res.end(success([
                { ACTION_LOG: 'อัพเดทสถานะ', CREATE_DATE: '2026-05-16T10:00:00', INST_LOG_ID: 1, REMARK: '', STATUS_CODE: 'FTI', PERSONAL_NAME: 'พ.ต.ท.ณัฐพล' },
                { ACTION_LOG: 'มอบหมาย', CREATE_DATE: '2026-05-16T08:00:00', INST_LOG_ID: 2, REMARK: 'มอบหมายให้ ร.ต.อ.วรวุฒิ', STATUS_CODE: 'CTV', PERSONAL_NAME: 'Admin' }
            ]));
            return;
        }

        // ========== Occupation ==========
        if (url.includes('occupation')) {
            res.end(success([
                { OCCUPATIONS_ID: 1, OCCUPATIONS_NAME: 'พนักงานบริษัท' },
                { OCCUPATIONS_ID: 2, OCCUPATIONS_NAME: 'ข้าราชการ' },
                { OCCUPATIONS_ID: 3, OCCUPATIONS_NAME: 'ค้าขาย' },
                { OCCUPATIONS_ID: 4, OCCUPATIONS_NAME: 'นักศึกษา' },
                { OCCUPATIONS_ID: 5, OCCUPATIONS_NAME: 'อื่นๆ' }
            ]));
            return;
        }

        // ========== Province ==========
        if (url.includes('province')) {
            res.end(success([
                { PROVINCE_ID: 10, PROVINCE_NAME_THA: 'กรุงเทพมหานคร' },
                { PROVINCE_ID: 12, PROVINCE_NAME_THA: 'นนทบุรี' }
            ]));
            return;
        }

        // ========== Organize ==========
        if (url.includes('organize')) {
            res.end(success([]));
            return;
        }

        // ========== Case Entity (Entity search, relation, detail) ==========
        if (url.includes('cmsonlinecaseentity')) {
            const params = body ? JSON.parse(body) : {};

            // CmsOnlineCaseEntity/detail — cases linked to a specific entity (MUST be before /identity check)
            if (url.includes('detail')) {
                const urlObj = new URL(req.url, `http://localhost:${PORT}`);
                const entityIdentity = urlObj.searchParams.get('entityIdentity') || '';

                if (!entityIdentity) {
                    res.end(success([]));
                    return;
                }

                const linkedCases = MOCK_CASE_DATA.filter(c =>
                    (c.Ext5 || '').includes(entityIdentity) ||
                    (c.OptionalData || '').includes(entityIdentity) ||
                    (c.FreezeActBankTrackNo || '').includes(entityIdentity)
                ).map(c => ({
                    TRACKING_CODE: c.TrackingCode,
                    ENTITY_TYPE: 'PERSON',
                    ENTITY_IDENTITY: entityIdentity,
                    ORG_NAME: c.OrganizeAbbr || '',
                    INST_ID: c.InstId,
                    CASE_TYPE_NAME: c.CaseTypeName,
                    STATUS_NAME: c.StatusName,
                    DAMAGE_VALUE: c.DamageValue,
                    CREATE_DATE: c.CreateDate
                }));

                res.end(success(linkedCases));
                return;
            }

            // CmsOnlineCaseEntity/identity/count — entity search
            if (url.includes('identity/count') || url.includes('identity')) {
                const condition = (params.Condition || params.condition || '').toUpperCase();
                const offset = params.Offset || 0;
                const length = params.Length || 20;

                // Build entity index from MOCK_CASE_DATA
                const entityMap = {}; // entityIdentity → {type, count, cases[]}
                MOCK_CASE_DATA.forEach(c => {
                    // Person entity from Ext5 (victim name)
                    if (c.Ext5) {
                        const name = c.Ext5.trim();
                        if (!entityMap[name]) entityMap[name] = { type: 'PERSON', count: 0, cases: [] };
                        entityMap[name].count++;
                        entityMap[name].cases.push(c.TrackingCode);
                    }
                    // Phone entity from OptionalData (extract phone patterns)
                    const phones = (c.OptionalData || '').match(/0[689]\d[\s-]?\d{3}[\s-]?\d{4}/g) || [];
                    phones.forEach(p => {
                        const clean = p.replace(/[\s-]/g, '');
                        if (!entityMap[clean]) entityMap[clean] = { type: 'PHONE', count: 0, cases: [] };
                        entityMap[clean].count++;
                        entityMap[clean].cases.push(c.TrackingCode);
                    });
                    // Bank account from FreezeActBankTrackNo
                    if (c.FreezeActBankTrackNo) {
                        const acc = c.FreezeActBankTrackNo;
                        if (!entityMap[acc]) entityMap[acc] = { type: 'BANK_ACCOUNT', count: 0, cases: [] };
                        entityMap[acc].count++;
                        entityMap[acc].cases.push(c.TrackingCode);
                    }
                });

                // Filter by condition
                let results = Object.entries(entityMap).map(([identity, info]) => ({
                    EntityIdentity: identity,
                    EntityType: info.type,
                    IdentityCounts: info.count
                }));

                if (condition) {
                    results = results.filter(e =>
                        e.EntityIdentity.toUpperCase().includes(condition)
                    );
                }

                // Sort by count desc, paginate
                results.sort((a, b) => b.IdentityCounts - a.IdentityCounts);
                const total = results.length;
                const page = results.slice(offset, offset + length);
                res.end(success({ Data: page, TotalCount: total }));
                return;
            }

            // CmsOnlineCaseEntity/paging — case relations
            if (url.includes('paging')) {
                const cposText = (params.CposText || '').toUpperCase();
                const offset = params.Offset || 0;
                const length = params.Length || 20;

                // ถ้าไม่มีคำค้น → return ว่าง (ไม่ return ทั้งหมด)
                if (!cposText) {
                    res.end(success({ Data: [], TotalCount: 0 }));
                    return;
                }

                let filtered = MOCK_CASE_DATA.filter(c =>
                    (c.TrackingCode || '').toUpperCase().includes(cposText) ||
                    (c.Ext5 || '').toUpperCase().includes(cposText) ||
                    (c.OptionalData || '').toUpperCase().includes(cposText) ||
                    (c.FreezeActBankTrackNo || '').toUpperCase().includes(cposText) ||
                    (c.CaseTypeName || '').toUpperCase().includes(cposText)
                );

                const results = filtered.map(c => {
                    const sameType = MOCK_CASE_DATA.filter(x => x.CaseTypeName === c.CaseTypeName && x.InstId !== c.InstId);
                    return {
                        CASE_ID: c.InstId,
                        CASE_NO: c.TrackingCode,
                        INST_ID: c.InstId,
                        CASE_TYPE_ABBR: c.CaseTypeName,
                        ORG_NAME: c.OrganizeAbbr || '',
                        STATUS_NAME: c.StatusName,
                        CREATE_DATE: c.CreateDate,
                        RELATION_COUNT: sameType.length
                    };
                });

                const total = results.length;
                const page = results.slice(offset, offset + length);
                res.end(success({ Data: page, TotalCount: total }));
                return;
            }


            // Fallback for other cmsonlinecaseentity requests
            res.end(success({ Data: [], TotalCount: 0 }));
            return;
        }

        // ========== Search Description ==========
        if (url.includes('searchdescription')) {
            res.end(success([]));
            return;
        }

        // ========== File services ==========
        if (url.includes('file') || url.includes('attachment')) {
            res.end(success([]));
            return;
        }

        // ========== ChatGpt ==========
        if (url.includes('chatgpt')) {
            const params = body ? JSON.parse(body) : {};
            const inputText = params.text || '';
            const featureId = params.featureId || 'unknown';

            // Build Codex prompt with role instruction
            const codexPrompt = 'คุณคือ AI ผู้ช่วยเจ้าหน้าที่ตำรวจ ตอบเฉพาะเนื้อหาที่ขอแบบกระชับ เป็นภาษาไทย ไม่ต้องมีคำนำหรือคำลงท้าย:\n\n' + inputText;

            // Tier 1: Try Codex CLI
            callCodex(codexPrompt)
                .then(answer => {
                    console.log(`[ChatGpt] ✅ Tier 1 (Codex) — feature: ${featureId}`);
                    res.end(success({ Answer: answer }));
                })
                .catch(err => {
                    console.warn(`[ChatGpt] ⚠️ Codex unavailable for feature "${featureId}":`, err.message);
                    if (featureId === 'document-drafting') {
                        // Tier 2/3 — template fallback designed for document-drafting text pattern
                        const fallbackAnswer = buildFallbackAnswer(inputText);
                        const tier = fallbackAnswer.includes('AI วิเคราะห์คดี') ? '2 (template)' : '3 (canned)';
                        console.log(`[ChatGpt] 📝 Tier ${tier} used`);
                        res.end(success({ Answer: fallbackAnswer }));
                    } else {
                        // Other features — return IsSuccess:false so frontend uses its own static fallback
                        console.log(`[ChatGpt] 📝 Tier fallback: returning empty for feature "${featureId}"`);
                        res.end(JSON.stringify({ IsSuccess: false, Value: null, Message: 'Codex unavailable' }));
                    }
                });
            return;
        }

        // ========== TDEX ==========
        if (url.includes('tdex')) {
            res.end(success({ SubscriberName: 'นาย ก.', Operator: 'AIS', Status: 'Active' }));
            return;
        }

        // ========== Numering ==========
        if (url.includes('numering')) {
            res.end(success({ Data: [], TotalCount: 0 }));
            return;
        }

        // ========== CaseType ==========
        if (url.includes('casetype')) {
            res.end(success([
                { CASE_TYPE_ID: 1, CASE_TYPE_NAME: 'หลอกลวงซื้อขายสินค้า/บริการ' },
                { CASE_TYPE_ID: 2, CASE_TYPE_NAME: 'หลอกลวงให้โอนเงิน (Call Center)' },
                { CASE_TYPE_ID: 3, CASE_TYPE_NAME: 'หลอกลวงการลงทุน' }
            ]));
            return;
        }

        // ========== TaskSendCenter ==========
        if (url.includes('tasksendcenter') || url.includes('sendcenter')) {
            res.end(success({ IsSuccess: true }));
            return;
        }

        // ========== Log ==========
        if (url.includes('log')) {
            res.end(success({ IsSuccess: true }));
            return;
        }

        // ========== Default ==========
        console.log(`  [UNMATCHED] ${req.url}`);
        res.end(success({}));
    });
});

server.listen(PORT, () => {
    console.log(`\n✅ Mock API Server running at http://localhost:${PORT}/api`);
    console.log(`   ${MOCK_CASE_DATA.length} cases loaded from Excel mock data`);
    console.log(`   Angular app environment.ts apiUrl should be: http://localhost:${PORT}/api`);
    console.log(`   Login: any username (13 digits) + any password\n`);
});
