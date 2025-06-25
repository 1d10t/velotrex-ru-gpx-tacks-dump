// ==UserScript==
// @name         velotrex parse
// @namespace    http://tampermonkey.net/
// @version      2025-06-19
// @description  Парсинг velotrex.ru через контекстное меню в списке треков
// @author       You
// @match        http://velotrex.ru/file_list.php?*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=velotrex.ru
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @grant        GM_download
// @require      https://cdn.jsdelivr.net/npm/jszip@2.7.0/dist/jszip.js
// @updateURL        https://raw.githubusercontent.com/1d10t/velotrex-ru-gpx-tacks-dump/main/velotrex_parse.user.js
// @downloadURL      https://raw.githubusercontent.com/1d10t/velotrex-ru-gpx-tacks-dump/main/velotrex_parse.user.js
// ==/UserScript==

const visited_urls = new Set();
const new_urls = new Set();
let parse_started = false;
let child_loading = false;
const tracks = new Map();
let checkInterval;

(function() {
    'use strict';

    visited_urls.add(location.toString());

    function checkUrl(url) {
        // Проверяем URL с протоколом http или https
        if ((url.startsWith('http://') || url.startsWith('https://')) &&
            url.includes('velotrex.ru') &&
            !visited_urls.has(url) &&
            !new_urls.has(url)) {
            new_urls.add(url);
            console.log('Добавлен новый URL:', url);
        }
    }

    function startParse() {
        if (parse_started) {
            return;
        }
        parse_started = true;
        console.log('Парсинг начат');
        parseUrls(document);

        // Запускаем проверку завершения парсинга
        checkInterval = setInterval(checkParsingComplete, 1000);
        //setTimeout(createAndDownloadArchive, 15*60*1000); // DBG
    }

    function checkParsingComplete() {
        if (new_urls.size === 0 && !child_loading) {
            clearInterval(checkInterval);
            console.log('Парсинг завершен, всего треков:', tracks.size);
            createAndDownloadArchive();
        }
    }

    async function createAndDownloadArchive() {
        if (tracks.size === 0) {
            console.log('Нет треков для архивирования');
            return;
        }

        const zip = new JSZip();
        const folder = zip.folder('velotrex_tracks');

        // Добавляем все треки в архив
        for (const [passportId, trackInfo] of tracks) {
            if (trackInfo.enhancedGpxBlob) {
                const filename = `${passportId}.gpx`;
                folder.file(filename, await trackInfo.enhancedGpxBlob.arrayBuffer());
                console.log(`Добавлен файл в архив: ${filename}`);
            }
        }
        /*tracks.forEach((trackInfo, passportId) => {
            if (trackInfo.enhancedGpxBlob) {
                const filename = `${passportId}.gpx`;
                folder.file(filename, trackInfo.enhancedGpxBlob);
                console.log(`Добавлен файл в архив: ${filename}`);
            }
        });*/



        // Генерируем архив
        //const content = await zip.generateAsync({type: 'blob'});
        const content = zip.generate({type: 'blob'});
        const archiveBlob = new Blob([content], {type: 'application/zip'});

        // Создаем URL для скачивания
        const url = URL.createObjectURL(archiveBlob);
        const archiveName = `velotrex_tracks_${new Date().toISOString().slice(0,10)}.zip`;

        console.log("Архив", {archiveName, url});
        //const a = document.createElement('a'); a.download=archiveName; a.href = url; a.click();

        // Скачиваем архив
        GM_download({
            url: url,
            name: archiveName,
            onload: () => {
                console.log('Архив успешно скачан');
                URL.revokeObjectURL(url);
            },
            onerror: (error) => {
                console.error('Ошибка скачивания архива:', error);
                URL.revokeObjectURL(url);
            }
        });
    }

    async function parseTrackInfo(doc) {
        const result = {
            basicInfo: {},
            description: "",
            photos: [],
            calculation: {},
            trackInfo: {},
            relatedData: {}
        };

        // Таб 1: Основная информация
        const pcontent1 = doc.getElementById('pcontent1');
        if (pcontent1) {
            result.basicInfo = {
                name: getTextContent(pcontent1, '#td_name'),
                formalType: getTextContent(pcontent1, '#td_real'),
                country: getTextContent(pcontent1, '#td_country'),
                region: getTextContent(pcontent1, '#td_region'),
                borders: getTextContent(pcontent1, '#td_borders'),
                roadType: getTextContent(pcontent1, '#td_road'),
                surfaceType: getTextContent(pcontent1, '#td_pav'),
                dates: getTextContent(pcontent1, '#td_time_go'),
                routeDesc: getTextContent(pcontent1, '#td_route_desc'),
                routeNum: getTextContent(pcontent1, '#td_route_num a'),
                author: getTextContent(pcontent1, '#td_author'),
                difficulty: getTextContent(pcontent1, 'td.par_value', 12),
                status: getTextContent(pcontent1, 'td.par_value', 13),
                passportId: getTextContent(pcontent1, 'input[name="pp_id"]', 0, 'value'),
                trackLength: getTextContent(pcontent1, '#track_len'),
                maxElevation: getTextContent(pcontent1, '#max_e'),
                minElevation: getTextContent(pcontent1, '#min_e'),
                elevationGain: getTextContent(pcontent1, '#up_len'),
                elevationLoss: getTextContent(pcontent1, '#down_len'),
                pointsCount: getTextContent(pcontent1, '#point_count'),
                avgInterval: getTextContent(pcontent1, '#interval'),
                totalTime: getTextContent(pcontent1, '#dur_pp'),
                movingTime: getTextContent(pcontent1, '#cmt'),
                avgSpeed: getTextContent(pcontent1, '#ov'),
                movingSpeed: getTextContent(pcontent1, '#mv'),
                xmlUrl: getTextContent(pcontent1, 'form[name="edit_par1"] td.par_value', 3),
                nakarteLink: getTextContent(pcontent1, '#td_nk')
            };

            // Связанные данные (обратное направление)
            result.relatedData = {
                reverseDesc: getTextContent(pcontent1, '#td_reverse_desc'),
                reverseNum: getTextContent(pcontent1, '#td_reverse_num a')
            };
        }

        // Таб 2: Описание
        const pcontent2 = doc.getElementById('pcontent2');
        if (pcontent2) {
            result.description = pcontent2.querySelector('p#descr_pre')?.textContent.trim() || "";
        }

        // Таб 3: Фотографии и карты
        const pcontent3 = doc.getElementById('pcontent3');
        if (pcontent3) {
            const photoElements = pcontent3.querySelectorAll('a[href^="showfile.php"]');
            result.photos = Array.from(photoElements).map(el => {
                const container = el.closest('center') || el.closest('td');
                return {
                    url: el.href,
                    thumbnail: el.querySelector('img')?.src,
                    description: container?.querySelector('span[id]')?.textContent.trim() || "",
                    size: container?.querySelector('span.info')?.textContent.trim() || "",
                    date: container?.querySelectorAll('span')[1]?.textContent.trim() || ""
                };
            });
        }

        // Таб 4: Расчеты и категорирование
        const pcontent4 = doc.getElementById('pcontent4');
        if (pcontent4) {
            const raschet = pcontent4.querySelector('#raschet');
            if (raschet && raschet.textContent.trim()) {
                result.calculation = {
                    length: getTextBetween(raschet.textContent, 'Протяжённость препятствия (Lпп):', 'км').trim(),
                    kpr: getTextBetween(raschet.textContent, 'Кпр =', '\n').trim(),
                    kpk: getTextBetween(raschet.textContent, 'Кпк =', '\n').trim(),
                    knv: getTextBetween(raschet.textContent, 'Кнв =', '\n').trim(),
                    kkr: getTextBetween(raschet.textContent, 'Ккр =', '\n').trim(),
                    kv: getTextBetween(raschet.textContent, 'Кв =', '\n').trim(),
                    seasonFactor: getTextBetween(raschet.textContent, 'Сезонный фактор:', '\n').trim(),
                    geoFactor: getTextBetween(raschet.textContent, 'Географический фактор:', '\n').trim(),
                    kt: getTextBetween(raschet.textContent, 'КТ =', '\n').trim(),
                    difficultyCategory: getTextBetween(raschet.textContent, 'Препятствие соответствует', 'категории трудности').trim()
                };

                // Покрытия
                const coverageTable = pcontent4.querySelector('table');
                if (coverageTable) {
                    result.calculation.coverage = Array.from(coverageTable.querySelectorAll('tr:not(#str0)')).map(row => {
                        const cells = row.querySelectorAll('td');
                        return {
                            id: cells[0]?.textContent.trim(),
                            length: cells[1]?.textContent.trim(),
                            type: cells[2]?.textContent.trim(),
                            kpk: cells[3]?.textContent.trim(),
                            note: cells[4]?.textContent.trim()
                        };
                    });
                }
            }
        }

        // Скачивание XML файла
        if (result.basicInfo.xmlUrl && result.basicInfo.xmlUrl.startsWith(location.origin)) {
            try {
                result.trackInfo.xmlBlob = await downloadXml(result.basicInfo.xmlUrl);
                console.log('XML файл успешно загружен');
            } catch (error) {
                console.error('Ошибка загрузки XML:', error);
            }
        }

        console.log('Информация о треке:', result);
        return result;
    }

    function makeRichGpxDescription(trackInfo) {
        // Создаем HTML описание для GPX файла
        let html = `<h1>${trackInfo.basicInfo.name || 'Без названия'}</h1>`;

        // Основная информация
        html += `<h2>Основные сведения</h2>`;
        html += `<ul>`;
        html += `<li><strong>Регион:</strong> ${trackInfo.basicInfo.region || 'Не указано'}</li>`;
        html += `<li><strong>Границы:</strong> ${trackInfo.basicInfo.borders || 'Не указано'}</li>`;
        html += `<li><strong>Даты прохождения:</strong> ${trackInfo.basicInfo.dates || 'Не указано'}</li>`;
        html += `<li><strong>Длина:</strong> ${trackInfo.basicInfo.trackLength || 'Не указано'}</li>`;
        html += `<li><strong>Категория трудности:</strong> ${trackInfo.basicInfo.difficulty || 'Не указано'}</li>`;
        html += `<li><strong>Тип покрытия:</strong> ${trackInfo.basicInfo.surfaceType || 'Не указано'}</li>`;
        html += `</ul>`;

        // Описание
        if (trackInfo.description) {
            html += `<h2>Описание</h2>`;
            html += `<p>${trackInfo.description.replace(/\n/g, '<br>')}</p>`;
        }

        // Расчеты
        if (trackInfo.calculation) {
            html += `<h2>Расчет категории трудности</h2>`;
            html += `<ul>`;
            html += `<li><strong>Кпр (протяженность):</strong> ${trackInfo.calculation.kpr || 'Не указано'}</li>`;
            html += `<li><strong>Кпк (покрытие):</strong> ${trackInfo.calculation.kpk || 'Не указано'}</li>`;
            html += `<li><strong>Кнв (набор высоты):</strong> ${trackInfo.calculation.knv || 'Не указано'}</li>`;
            html += `<li><strong>Ккр (крутизна):</strong> ${trackInfo.calculation.kkr || 'Не указано'}</li>`;
            html += `<li><strong>КТ (итоговый):</strong> ${trackInfo.calculation.kt || 'Не указано'}</li>`;
            html += `</ul>`;
        }

        // Фотографии
        if (trackInfo.photos && trackInfo.photos.length > 0) {
            html += `<h2>Фотоматериалы (${trackInfo.photos.length})</h2>`;
            html += `<ul>`;
            trackInfo.photos.forEach(photo => {
                html += `<li><a href="${photo.url}">${photo.description || 'Фото'}</a> (${photo.date || 'без даты'})</li>`;
            });
            html += `</ul>`;
        }

        return html;
    }

    function makeTrackStyle(trackInfo) {
        // Определяем стиль трека на основе категории трудности и типа
        const difficulty = parseInt(trackInfo.basicInfo.difficulty) || 1;
        const isFormal = trackInfo.basicInfo.formalType === 'планируемый';

        // Цвет от зеленого (1) до красного (6)
        const colors = [
            '#4CAF50', // 1 - зеленый
            '#8BC34A', // 2 - светло-зеленый
            '#FFC107', // 3 - желтый
            '#FF9800', // 4 - оранжевый
            '#FF5722', // 5 - оранжево-красный
            '#F44336'  // 6 - красный
        ];

        const color = colors[Math.min(difficulty, 6) - 1];
        const lineStyle = isFormal ? 'dash' : 'solid';

        return {
            color,
            width: 3,
            lineStyle,
            opacity: 0.8
        };
    }

    function parseUrls(doc) {
        const urls = Array.from(doc.querySelectorAll('a.pagecounter[href], td.useritem_align_left a[href]'))
                         .map(e => e.href.toString());

        urls.forEach(url => checkUrl(url));

        if (!document.getElementById('child')) {
            const iframe = document.createElement('iframe');
            iframe.id = 'child';
            iframe.style.height = '600px';
            iframe.style.width = '100%';
            iframe.style.border = '1px solid #ccc';
            iframe.style.display = 'none';
            document.body.appendChild(iframe);

            iframe.onload = async function() {
                child_loading = false;
                const childDoc = iframe.contentDocument || iframe.contentWindow.document;

                if (iframe.src.includes('/file_list.php')) {
                    parseUrls(childDoc);
                } else if (iframe.src.includes('/trackview.php')) {
                    try {
                        const trackInfo = await parseTrackInfo(childDoc);
                        console.log('Получена информация о треке:', trackInfo);

                        const description = makeRichGpxDescription(trackInfo);
                        const trackStyle = makeTrackStyle(trackInfo);

                        // Добавляем стиль и описание к данным трека
                        trackInfo.trackStyle = trackStyle;
                        trackInfo.gpxDescription = description;

                        // Сохраняем трек с обновленными данными
                        await saveEnhancedTrack(trackInfo);
                        //console.log(URL.createObjectURL(trackInfo.enhancedGpxBlob));

                        tracks.set(trackInfo.basicInfo.passportId, trackInfo);
                    } catch (error) {
                        console.error('Ошибка обработки трека:', error);
                    }
                }
            };
        }
    }

    async function saveEnhancedTrack(trackInfo) {
        if (!trackInfo.trackInfo.xmlBlob) return;

        try {
            // Читаем содержимое GPX файла
            const text = await trackInfo.trackInfo.xmlBlob.text();
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(text, "text/xml");

            // Добавляем необходимые namespace declarations
            const gpxElement = xmlDoc.querySelector('gpx');
            if (gpxElement) {
                gpxElement.setAttribute('xmlns:locus', 'http://www.locusmap.eu');
                gpxElement.setAttribute('xmlns:gpx_style', 'http://www.topografix.com/GPX/gpx_style/0/2');
                gpxElement.setAttribute('xmlns:xsi', 'http://www.w3.org/2001/XMLSchema-instance');
                gpxElement.setAttribute('xsi:schemaLocation',
                                        'http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd ' +
                                        'http://www.topografix.com/GPX/gpx_style/0/2 http://www.topografix.com/GPX/gpx_style/0/2/gpx_style.xsd');
            }

            // Удаление всех элементов <metadata>
            xmlDoc.querySelectorAll('metadata').forEach(el => el.remove());

            // Обновляем наименование трека
            const trks = xmlDoc.querySelectorAll('trk');
            trks.forEach(trk => {
                const nameElement = trk.querySelector('name');
                if (nameElement) {
                    nameElement.textContent = trackInfo.basicInfo.name || 'Без названия';
                } else {
                    const newNameElement = xmlDoc.createElement('name');
                    newNameElement.textContent = trackInfo.basicInfo.name || 'Без названия';
                    trk.insertBefore(newNameElement, trk.firstChild);
                }

                const desc = xmlDoc.createElement('desc');

                // Создаем CDATA секцию для HTML описания
                const htmlDescription = makeRichGpxDescription(trackInfo);
                const cdata = xmlDoc.createCDATASection(htmlDescription);
                desc.appendChild(cdata);
                trk.appendChild(desc);

                // Создаем элементы extensions для стиля линии
                const extensions = xmlDoc.createElement('extensions');

                const line = xmlDoc.createElementNS('http://www.topografix.com/GPX/gpx_style/0/2', 'gpx_style:line');

                // Основные параметры линии
                const color = xmlDoc.createElementNS('http://www.topografix.com/GPX/gpx_style/0/2', 'gpx_style:color');
                color.textContent = trackInfo.trackStyle.color.replace('#', ''); // Удаляем # для формата RRGGBB
                line.appendChild(color);

                const opacity = xmlDoc.createElementNS('http://www.topografix.com/GPX/gpx_style/0/2', 'gpx_style:opacity');
                opacity.textContent = trackInfo.trackStyle.opacity || '1.00';
                line.appendChild(opacity);

                const width = xmlDoc.createElementNS('http://www.topografix.com/GPX/gpx_style/0/2', 'gpx_style:width');
                width.textContent = trackInfo.trackStyle.width || '6.0';
                line.appendChild(width);

                // Расширения Locus Map
                const lineExtensions = xmlDoc.createElement('extensions');

                const lsColorBase = xmlDoc.createElementNS('http://www.locusmap.eu', 'locus:lsColorBase');
                lsColorBase.textContent = `#FF${trackInfo.trackStyle.color.replace('#', '')}`;
                lineExtensions.appendChild(lsColorBase);

                if (trackInfo.trackStyle.lineStyle === 'dash') {
                    const lsSymbol = xmlDoc.createElementNS('http://www.locusmap.eu', 'locus:lsSymbol');
                    lsSymbol.textContent = 'DOTTED';
                    lineExtensions.appendChild(lsSymbol);

                    const lsColorSymbol = xmlDoc.createElementNS('http://www.locusmap.eu', 'locus:lsColorSymbol');
                    lsColorSymbol.textContent = '#FFFFFFFF';
                    lineExtensions.appendChild(lsColorSymbol);
                }

                const lsWidth = xmlDoc.createElementNS('http://www.locusmap.eu', 'locus:lsWidth');
                lsWidth.textContent = trackInfo.trackStyle.width || '3.0';
                lineExtensions.appendChild(lsWidth);

                const lsUnits = xmlDoc.createElementNS('http://www.locusmap.eu', 'locus:lsUnits');
                lsUnits.textContent = 'PIXELS';
                lineExtensions.appendChild(lsUnits);

                line.appendChild(lineExtensions);
                extensions.appendChild(line);

                const locusActivity = xmlDoc.createElementNS('http://www.locusmap.eu', 'locus:activity');
                locusActivity.textContent = 'cycling_mountain';
                extensions.appendChild(locusActivity);

                trk.appendChild(extensions);

            });

            // Преобразуем обратно в строку
            const serializer = new XMLSerializer();
            let updatedGpx = serializer.serializeToString(xmlDoc);

            // Фикс для корректного отображения XML header
            updatedGpx = updatedGpx.replace(/<\?xml.*\?>/, '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>');

            // Создаем новый Blob
            trackInfo.enhancedGpxBlob = new Blob([updatedGpx], { type: 'application/gpx+xml' });

            console.log('Трек успешно обновлен с дополнительной информацией');
            //console.log('Обновленный GPX:', updatedGpx);
        } catch (error) {
            console.error('Ошибка при обновлении GPX файла:', error);
        }
    }

    async function downloadXml(url) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url: url,
                responseType: 'blob',
                onload: function(response) {
                    resolve(response.response);
                },
                onerror: function(error) {
                    reject(error);
                }
            });
        });
    }

    setInterval(() => {
        if (!parse_started || child_loading || new_urls.size === 0) {
            return;
        }

        const [nextUrl] = new_urls;
        new_urls.delete(nextUrl);
        visited_urls.add(nextUrl);

        const iframe = document.getElementById('child');
        if (iframe) {
            child_loading = true;
            iframe.style.display = 'block';
            iframe.src = nextUrl;
            console.log('Загружаем URL:', nextUrl);
        }
    }, 500);

    // Регистрируем команду в контекстном меню
    GM_registerMenuCommand("Парсить Velotrex", startParse);

    // Вспомогательные функции
    function getTextContent(element, selector, index = 0, attr = null) {
        const el = element?.querySelectorAll(selector)[index];
        if (!el) return null;
        return attr ? el.getAttribute(attr) : el.textContent.trim();
    }

    function getTextBetween(text, start, end) {
        const startIndex = text.indexOf(start);
        if (startIndex === -1) return null;
        const endIndex = text.indexOf(end, startIndex + start.length);
        return endIndex === -1 ? null : text.substring(startIndex + start.length, endIndex).trim();
    }
})();

