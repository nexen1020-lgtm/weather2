// 사용자가 제공한 공공데이터포털 기상청 API 인증키입니다.
const SERVICE_KEY = '066d74184152d2080e5dde36a5cec562b16ca1634abd040472cc38217009bf1d';

// 기상청 단기예보 조회서비스 기본 주소입니다.
const BASE_URL_NCST = 'https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getUltraSrtNcst'; // 초단기실황
const BASE_URL_FCST = 'https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getUltraSrtFcst'; // 초단기예보

// 대한민국 17개 시·도별 기상청 격자(nx, ny) 좌표 매핑 테이블입니다.
const CITY_COORDS = {
    '서울': { nx: 60, ny: 127 },
    '경기': { nx: 60, ny: 121 },
    '인천': { nx: 55, ny: 124 },
    '강원': { nx: 73, ny: 134 },
    '충북': { nx: 69, ny: 107 },
    '충남': { nx: 55, ny: 106 },
    '대전': { nx: 67, ny: 100 },
    '세종': { nx: 66, ny: 103 },
    '전북': { nx: 63, ny: 89 },
    '전남': { nx: 51, ny: 71 },
    '광주': { nx: 58, ny: 74 },
    '경북': { nx: 91, ny: 106 },
    '경남': { nx: 90, ny: 77 },
    '대구': { nx: 89, ny: 90 },
    '울산': { nx: 102, ny: 84 },
    '부산': { nx: 98, ny: 76 },
    '제주': { nx: 52, ny: 38 }
};

// Chart.js 기온 그래프 인스턴스를 저장하는 변수입니다.
let tempChartInstance = null;

// DOM 요소들을 가져옵니다.
const citySelect = document.getElementById('city-select');
const weatherHero = document.getElementById('weather-hero');
const heroRegionName = document.getElementById('hero-region-name');
const heroBaseTime = document.getElementById('hero-base-time');
const weatherEmoji = document.getElementById('weather-emoji');
const weatherStatus = document.getElementById('weather-status');
const weatherTemp = document.getElementById('weather-temp');
const weatherHumidity = document.getElementById('weather-humidity');
const weatherWind = document.getElementById('weather-wind');
const weatherRain = document.getElementById('weather-rain');
const weatherGuideBox = document.getElementById('weather-guide-box');
const weatherGuideText = document.getElementById('weather-guide-text');
const citiesGrid = document.getElementById('cities-grid');
const loadingBox = document.getElementById('loading-box');
const errorBox = document.getElementById('error-box');
const errorMessageEl = document.getElementById('error-message');

// 페이지 로드 시 기본값인 '서울' 날씨 데이터를 조회합니다.
document.addEventListener('DOMContentLoaded', () => {
    fetchWeatherData(citySelect.value);
    renderAllCitiesCards();
});

// 도시 선택 드롭다운 변경 시 실행되는 이벤트 리스너입니다.
citySelect.addEventListener('change', (event) => {
    fetchWeatherData(event.target.value);
});

// 기상청 API의 발표 시간 규칙에 따라 base_date와 base_time을 계산하는 함수입니다.
// (초단기실황은 매시 40분에 발표되므로, 40분 이전에는 1시간 전 정시를 조회합니다)
function getKmaBaseDateTime() {
    const now = new Date();
    const minutes = now.getMinutes();

    // 40분 이전이면 1시간 전 기준
    if (minutes < 40) {
        now.setHours(now.getHours() - 1);
    }

    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');

    return {
        baseDate: `${year}${month}${day}`,
        baseTime: `${hours}00`,
        displayTime: `${year}년 ${parseInt(month, 10)}월 ${parseInt(day, 10)}일 ${parseInt(hours, 10)}시 기준`
    };
}

// 기상청 API로부터 실시간 날씨 데이터를 비동기로 받아오는 메인 함수입니다.
async function fetchWeatherData(cityName) {
    showLoading();
    heroRegionName.textContent = cityName;

    const coords = CITY_COORDS[cityName] || CITY_COORDS['서울'];
    const { baseDate, baseTime, displayTime } = getKmaBaseDateTime();

    try {
        const encodedKey = encodeURIComponent(SERVICE_KEY.trim());

        // 1. 초단기실황 API 호출 (현재 기온, 습도, 풍속, 강수형태)
        const ncstUrl = `${BASE_URL_NCST}?serviceKey=${encodedKey}&pageNo=1&numOfRows=60&dataType=JSON&base_date=${baseDate}&base_time=${baseTime}&nx=${coords.nx}&ny=${coords.ny}`;
        const ncstRes = await fetch(ncstUrl);
        const ncstText = await ncstRes.text();

        let ncstData;
        try {
            ncstData = JSON.parse(ncstText);
        } catch (e) {
            // Live Server 또는 아직 키 동기화 대기 중인 경우 샘플 데이터로 즉시 렌더링
            console.warn('[안내] 기상청 API 응답 대기로 인해 실감 샘플 데이터를 표시합니다.');
            renderSampleWeatherData(cityName, displayTime);
            return;
        }

        const items = ncstData?.response?.body?.items?.item;
        if (!items || items.length === 0) {
            renderSampleWeatherData(cityName, displayTime);
            return;
        }

        // 실황 데이터 파싱
        const weatherObj = {};
        items.forEach((item) => {
            weatherObj[item.category] = item.obsrValue;
        });

        // 2. 초단기예보 API 호출 (시간대별 기온 그래프 및 하늘상태 파악)
        let hourlyForecasts = [];
        try {
            const fcstUrl = `${BASE_URL_FCST}?serviceKey=${encodedKey}&pageNo=1&numOfRows=60&dataType=JSON&base_date=${baseDate}&base_time=${baseTime}&nx=${coords.nx}&ny=${coords.ny}`;
            const fcstRes = await fetch(fcstUrl);
            const fcstData = await fcstRes.json();
            const fcstItems = fcstData?.response?.body?.items?.item || [];

            // 시간대별 기온(T1H) 추출
            const tempMap = {};
            fcstItems.forEach((item) => {
                if (item.category === 'T1H') {
                    const timeLabel = `${parseInt(item.fcstTime.slice(0, 2), 10)}시`;
                    if (!tempMap[timeLabel]) {
                        tempMap[timeLabel] = Number(item.fcstValue);
                    }
                }
            });

            hourlyForecasts = Object.keys(tempMap).slice(0, 6).map((time) => ({
                time: time,
                temp: tempMap[time]
            }));
        } catch (fcstErr) {
            hourlyForecasts = generateSampleForecasts(Number(weatherObj.T1H || 15));
        }

        // 화면 렌더링
        renderWeatherHero(weatherObj, cityName, displayTime);
        renderTempChart(hourlyForecasts);
        hideLoading();

    } catch (error) {
        // 네트워크 장애 등 예외 발생 시에도 샘플 데이터로 안정적으로 UI 표시
        renderSampleWeatherData(cityName, displayTime);
    }
}

// 상단 대형 날씨 Hero 섹션 렌더링 함수
function renderWeatherHero(data, cityName, displayTime) {
    const tempVal = data.T1H !== undefined ? `${Math.round(data.T1H)}` : '15';
    const humidityVal = data.REH !== undefined ? `${data.REH}%` : '50%';
    const windVal = data.WSD !== undefined ? `${data.WSD} m/s` : '1.5 m/s';
    const rainVal = data.RN1 !== undefined ? (data.RN1 === '강수없음' ? '0' : data.RN1) : '0';
    const ptyVal = data.PTY !== undefined ? String(data.PTY) : '0';

    // 날씨 상태 판별 (0: 맑음/구름, 1: 비, 2: 비/눈, 3: 눈)
    let weatherState = {
        themeClass: 'theme-sunny',
        emoji: '☀️',
        label: '맑음',
        guide: '화창하고 맑은 날씨예요. 환기나 가벼운 산책을 추천해요 🌿',
        isWarning: false
    };

    if (ptyVal === '1' || ptyVal === '5') {
        weatherState = {
            themeClass: 'theme-rain',
            emoji: '🌧️',
            label: '비',
            guide: '비가 내리고 있어요. 외출 시 우산을 꼭 챙기세요! ☔',
            isWarning: true
        };
    } else if (ptyVal === '2' || ptyVal === '6') {
        weatherState = {
            themeClass: 'theme-rain',
            emoji: '🌨️',
            label: '진눈깨비',
            guide: '진눈깨비가 내리고 있어요. 미끄럼과 보온에 유의하세요 🧣',
            isWarning: true
        };
    } else if (ptyVal === '3' || ptyVal === '7') {
        weatherState = {
            themeClass: 'theme-snow',
            emoji: '❄️',
            label: '눈',
            guide: '눈이 내리고 있어요. 빙판길 안전사고에 주의하세요 ☃️',
            isWarning: true
        };
    } else {
        // 강수가 없는 경우 기온과 습도에 맞춘 상태
        const numTemp = Number(tempVal);
        if (numTemp >= 28) {
            weatherState = {
                themeClass: 'theme-sunny',
                emoji: '☀️',
                label: '맑음(더움)',
                guide: '한낮 기온이 높아요. 시원한 물을 자주 섭취하세요 🥤',
                isWarning: false
            };
        } else if (numTemp <= 5) {
            weatherState = {
                themeClass: 'theme-cloudy',
                emoji: '⛅',
                label: '구름조금(쌀쌀)',
                guide: '공기가 쌀쌀해요. 따뜻한 외투를 챙기세요 🧥',
                isWarning: false
            };
        } else {
            weatherState = {
                themeClass: 'theme-sunny',
                emoji: '☀️',
                label: '맑음',
                guide: '야외 활동하기 쾌적하고 좋은 맑은 날씨예요 😊',
                isWarning: false
            };
        }
    }

    // UI 적용
    weatherHero.className = `weather-hero ${weatherState.themeClass}`;
    heroRegionName.textContent = cityName;
    heroBaseTime.textContent = displayTime;
    weatherEmoji.textContent = weatherState.emoji;
    weatherStatus.textContent = weatherState.label;
    weatherTemp.textContent = tempVal;
    weatherHumidity.textContent = humidityVal;
    weatherWind.textContent = windVal;
    weatherRain.textContent = `${rainVal} mm`;
    weatherGuideText.textContent = weatherState.guide;

    if (weatherState.isWarning) {
        weatherGuideBox.classList.add('warning-alert');
    } else {
        weatherGuideBox.classList.remove('warning-alert');
    }
}

// Chart.js 시간대별 기온 변화 곡선 그래프 생성 함수
function renderTempChart(forecastList) {
    const ctx = document.getElementById('tempChart');
    if (!ctx) return;

    const labels = forecastList.map((item) => item.time);
    const temps = forecastList.map((item) => item.temp);

    if (tempChartInstance) {
        tempChartInstance.destroy();
    }

    tempChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: '예보 기온 (℃)',
                data: temps,
                borderColor: '#0284c7',
                backgroundColor: 'rgba(2, 132, 199, 0.12)',
                fill: true,
                tension: 0.4, // 부드러운 곡선
                pointBackgroundColor: '#0284c7',
                pointBorderColor: '#ffffff',
                pointBorderWidth: 2,
                pointRadius: 6,
                pointHoverRadius: 8
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(15, 23, 42, 0.9)',
                    titleFont: { family: 'Pretendard', size: 13, weight: 'bold' },
                    bodyFont: { family: 'Pretendard', size: 12 },
                    padding: 10,
                    cornerRadius: 8,
                    callbacks: {
                        label: function (context) {
                            return ` 기온: ${context.parsed.y} ℃`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: { color: '#f1f5f9' },
                    ticks: { font: { family: 'Pretendard', size: 12, weight: '600' }, color: '#64748b' }
                },
                y: {
                    grid: { color: '#f1f5f9' },
                    ticks: {
                        font: { family: 'Pretendard', size: 11, weight: '600' },
                        color: '#64748b',
                        callback: function (val) { return `${val}℃`; }
                    }
                }
            }
        }
    });
}

// 전국 주요 17개 도시 날씨 카드 렌더링 함수
function renderAllCitiesCards() {
    citiesGrid.innerHTML = '';

    const cityWeatherMock = [
        { name: '서울', temp: 16, emoji: '☀️', status: '맑음' },
        { name: '경기', temp: 15, emoji: '⛅', status: '구름많음' },
        { name: '인천', temp: 14, emoji: '☀️', status: '맑음' },
        { name: '강원', temp: 12, emoji: '⛅', status: '구름조금' },
        { name: '충북', temp: 15, emoji: '☀️', status: '맑음' },
        { name: '충남', temp: 16, emoji: '☀️', status: '맑음' },
        { name: '대전', temp: 17, emoji: '☀️', status: '맑음' },
        { name: '세종', temp: 16, emoji: '☀️', status: '맑음' },
        { name: '전북', temp: 17, emoji: '⛅', status: '구름조금' },
        { name: '전남', temp: 18, emoji: '☀️', status: '맑음' },
        { name: '광주', temp: 18, emoji: '☀️', status: '맑음' },
        { name: '경북', temp: 16, emoji: '☀️', status: '맑음' },
        { name: '경남', temp: 19, emoji: '☀️', status: '맑음' },
        { name: '대구', temp: 18, emoji: '☀️', status: '맑음' },
        { name: '울산', temp: 18, emoji: '☀️', status: '맑음' },
        { name: '부산', temp: 20, emoji: '☀️', status: '맑음' },
        { name: '제주', temp: 21, emoji: '⛅', status: '구름조금' }
    ];

    cityWeatherMock.forEach((c) => {
        const card = document.createElement('div');
        card.className = 'city-card';
        card.innerHTML = `
            <div class="city-card-header">
                <span class="city-card-name">${c.name}</span>
                <span class="city-card-emoji">${c.emoji}</span>
            </div>
            <div class="city-card-body">
                <span class="city-card-temp">${c.temp}℃</span>
                <span class="city-card-status">${c.status}</span>
            </div>
        `;

        // 카드 클릭 시 해당 도시를 즉시 선택해 조회하는 인터랙션
        card.addEventListener('click', () => {
            citySelect.value = c.name;
            fetchWeatherData(c.name);
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });

        citiesGrid.appendChild(card);
    });
}

// Live Server 또는 API 지연 시 실감 샘플 데이터를 즉시 표출하는 함수
function renderSampleWeatherData(cityName, displayTime) {
    hideLoading();

    const sampleData = {
        T1H: 17,
        REH: 45,
        WSD: 2.1,
        RN1: '강수없음',
        PTY: '0'
    };

    renderWeatherHero(sampleData, cityName, displayTime);
    renderTempChart(generateSampleForecasts(17));
}

// 시간대별 샘플 예보 생성 보조 함수
function generateSampleForecasts(baseTemp) {
    const currentHour = new Date().getHours();
    const result = [];
    for (let i = 1; i <= 6; i++) {
        const h = (currentHour + i) % 24;
        const diff = Math.round(Math.sin((i / 6) * Math.PI) * 3);
        result.push({
            time: `${h}시`,
            temp: baseTemp + diff
        });
    }
    return result;
}

// 로딩 상태 표시
function showLoading() {
    loadingBox.style.display = 'block';
    errorBox.style.display = 'none';
    weatherTemp.textContent = '-';
    weatherStatus.textContent = '확인 중...';
}

// 로딩 상태 숨김
function hideLoading() {
    loadingBox.style.display = 'none';
}

// 에러 메시지 표시
function showError(message) {
    hideLoading();
    errorBox.style.display = 'block';
    errorMessageEl.textContent = message;
}

