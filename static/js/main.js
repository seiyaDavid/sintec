document.addEventListener('DOMContentLoaded', function () {
    // Form submission for file upload
    const uploadForm = document.getElementById('uploadForm');
    uploadForm.addEventListener('submit', function (e) {
        e.preventDefault();

        const fileInput = document.getElementById('dataFile');
        const file = fileInput.files[0];

        if (!file) {
            alert('Please select a file to upload');
            return;
        }

        const formData = new FormData();
        formData.append('file', file);

        fetch('/upload', {
            method: 'POST',
            body: formData
        })
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    displayOriginalData(data.data_info);
                    document.getElementById('generateCard').style.display = 'block';
                } else {
                    alert(data.error || 'An error occurred during upload');
                }
            })
            .catch(error => {
                console.error('Error:', error);
                alert('An error occurred during upload');
            });
    });

    // Form submission for synthetic data generation
    const generateForm = document.getElementById('generateForm');
    generateForm.addEventListener('submit', function (e) {
        e.preventDefault();

        const method = document.getElementById('generationMethod').value;

        // Show progress indicator
        document.getElementById('generationProgress').style.display = 'block';

        fetch('/generate_synthetic', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ method: method })
        })
            .then(response => response.json())
            .then(data => {
                // Hide progress indicator
                document.getElementById('generationProgress').style.display = 'none';

                if (data.success) {
                    displaySyntheticData(data.synthetic_preview);
                    displayAnalysis(data.analysis, data.visualizations);
                    document.getElementById('syntheticDataCard').style.display = 'block';
                    document.getElementById('analysisSection').style.display = 'block';
                } else {
                    alert(data.error || 'An error occurred during synthetic data generation');
                }
            })
            .catch(error => {
                // Hide progress indicator
                document.getElementById('generationProgress').style.display = 'none';

                console.error('Error:', error);
                alert('An error occurred during synthetic data generation');
            });
    });

    // Download synthetic data
    const downloadBtn = document.getElementById('downloadBtn');
    downloadBtn.addEventListener('click', function () {
        fetch('/download_synthetic')
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    // Create CSV content
                    const csvContent = convertToCSV(data.data);

                    // Create download link
                    const blob = new Blob([csvContent], { type: 'text/csv' });
                    const url = window.URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.setAttribute('hidden', '');
                    a.setAttribute('href', url);
                    a.setAttribute('download', 'synthetic_data.csv');
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                } else {
                    alert(data.error || 'An error occurred during download');
                }
            })
            .catch(error => {
                console.error('Error:', error);
                alert('An error occurred during download');
            });
    });

    // Function to display original data
    function displayOriginalData(dataInfo) {
        // Display data info
        const infoElement = document.getElementById('originalDataInfo');
        infoElement.innerHTML = `
            <p><strong>Rows:</strong> ${dataInfo.rows}</p>
            <p><strong>Columns:</strong> ${dataInfo.columns}</p>
        `;

        // Display data preview
        const headElement = document.getElementById('originalDataHead');
        const bodyElement = document.getElementById('originalDataBody');

        // Create table header
        let headerRow = '<tr>';
        dataInfo.column_names.forEach(column => {
            headerRow += `<th>${column}</th>`;
        });
        headerRow += '</tr>';
        headElement.innerHTML = headerRow;

        // Create table body
        let bodyRows = '';
        dataInfo.preview.forEach(row => {
            bodyRows += '<tr>';
            dataInfo.column_names.forEach(column => {
                bodyRows += `<td>${row[column] !== null && row[column] !== undefined ? row[column] : ''}</td>`;
            });
            bodyRows += '</tr>';
        });
        bodyElement.innerHTML = bodyRows;

        // Show the card
        document.getElementById('originalDataCard').style.display = 'block';
    }

    // Function to display synthetic data
    function displaySyntheticData(preview) {
        // Get column names from the first row
        const columns = Object.keys(preview[0] || {});

        // Display data preview
        const headElement = document.getElementById('syntheticDataHead');
        const bodyElement = document.getElementById('syntheticDataBody');

        // Create table header
        let headerRow = '<tr>';
        columns.forEach(column => {
            headerRow += `<th>${column}</th>`;
        });
        headerRow += '</tr>';
        headElement.innerHTML = headerRow;

        // Create table body
        let bodyRows = '';
        preview.forEach(row => {
            bodyRows += '<tr>';
            columns.forEach(column => {
                bodyRows += `<td>${row[column] !== null && row[column] !== undefined ? row[column] : ''}</td>`;
            });
            bodyRows += '</tr>';
        });
        bodyElement.innerHTML = bodyRows;
    }

    // Function to display analysis results
    function displayAnalysis(analysis, visualizations) {
        // Summary tab
        const summaryElement = document.getElementById('summaryContent');
        let summaryHTML = '<h4>Statistical Summary Comparison</h4>';

        // Create summary tables for numerical columns
        const columns = Object.keys(analysis.original_stats || {});
        columns.forEach(column => {
            summaryHTML += `
                <div class="stat-card">
                    <h6>${column}</h6>
                    <div class="table-responsive">
                        <table class="table table-sm">
                            <thead>
                                <tr>
                                    <th>Metric</th>
                                    <th>Original</th>
                                    <th>Synthetic</th>
                                    <th>Difference</th>
                                </tr>
                            </thead>
                            <tbody>
            `;

            const metrics = Object.keys(analysis.original_stats[column] || {});
            metrics.forEach(metric => {
                const origValue = analysis.original_stats[column][metric];
                const synthValue = analysis.synthetic_stats[column][metric];
                let diff = '';

                if (typeof origValue === 'number' && typeof synthValue === 'number') {
                    const diffValue = ((synthValue - origValue) / (Math.abs(origValue) || 1) * 100).toFixed(2);
                    diff = `${diffValue}%`;
                }

                summaryHTML += `
                    <tr>
                        <td>${metric}</td>
                        <td>${typeof origValue === 'number' ? origValue.toFixed(4) : origValue}</td>
                        <td>${typeof synthValue === 'number' ? synthValue.toFixed(4) : synthValue}</td>
                        <td>${diff}</td>
                    </tr>
                `;
            });

            summaryHTML += `
                        </tbody>
                    </table>
                </div>
            </div>
            `;
        });

        summaryElement.innerHTML = summaryHTML;

        // Correlation tab
        const correlationElement = document.getElementById('correlationContent');
        let correlationHTML = '<h4>Correlation Analysis</h4>';

        correlationHTML += `
            <div class="table-responsive">
                <table class="table table-sm correlation-table">
                    <thead>
                        <tr>
                            <th>Column</th>
                            <th>Correlation</th>
                            <th>P-Value</th>
                            <th>Interpretation</th>
                        </tr>
                    </thead>
                    <tbody>
        `;

        Object.keys(analysis.correlation_scores || {}).forEach(column => {
            const corr = analysis.correlation_scores[column].correlation;
            const pValue = analysis.correlation_scores[column].p_value;

            let interpretation = '';
            let cssClass = '';

            if (corr !== null) {
                const absCorr = Math.abs(corr);
                if (absCorr > 0.7) {
                    interpretation = 'Strong similarity';
                    cssClass = 'correlation-high';
                } else if (absCorr > 0.3) {
                    interpretation = 'Moderate similarity';
                    cssClass = 'correlation-medium';
                } else {
                    interpretation = 'Weak similarity';
                    cssClass = 'correlation-low';
                }
            } else {
                interpretation = 'Could not calculate';
            }

            correlationHTML += `
                <tr class="${cssClass}">
                    <td>${column}</td>
                    <td>${corr !== null ? corr.toFixed(4) : 'N/A'}</td>
                    <td>${pValue !== null ? pValue.toFixed(4) : 'N/A'}</td>
                    <td>${interpretation}</td>
                </tr>
            `;
        });

        correlationHTML += `
                    </tbody>
                </table>
            </div>
        `;

        // Add mutual information for categorical variables
        if (Object.keys(analysis.mutual_info || {}).length > 0) {
            correlationHTML += `
                <h5 class="mt-4">Mutual Information for Categorical Variables</h5>
                <p>Higher values indicate stronger relationship between original and synthetic data</p>
                <div class="table-responsive">
                    <table class="table table-sm">
                        <thead>
                            <tr>
                                <th>Column</th>
                                <th>Mutual Information</th>
                            </tr>
                        </thead>
                        <tbody>
            `;

            Object.keys(analysis.mutual_info).forEach(column => {
                const mi = analysis.mutual_info[column];
                correlationHTML += `
                    <tr>
                        <td>${column}</td>
                        <td>${mi !== null ? mi.toFixed(4) : 'N/A'}</td>
                    </tr>
                `;
            });

            correlationHTML += `
                        </tbody>
                    </table>
                </div>
            `;
        }

        correlationElement.innerHTML = correlationHTML;

        // Quality metrics tab
        const qualityElement = document.getElementById('qualityContent');
        let qualityHTML = '<h4>Synthetic Data Quality Metrics</h4>';

        if (analysis.quality_scores && analysis.quality_scores.error) {
            qualityHTML += `<div class="alert alert-warning">${analysis.quality_scores.error}</div>`;
        } else if (analysis.quality_scores) {
            // Overall quality score
            if (analysis.quality_scores.overall_quality !== undefined) {
                qualityHTML += `
                    <div class="stat-card">
                        <h5>Overall Quality Score: ${(analysis.quality_scores.overall_quality * 100).toFixed(2)}%</h5>
                        <p>Higher score indicates better quality of synthetic data</p>
                    </div>
                `;
            }

            // Properties
            if (analysis.quality_scores.properties) {
                const properties = analysis.quality_scores.properties;

                // Check for column shapes
                if (properties.column_shapes) {
                    qualityHTML += `
                        <h5 class="mt-3">Column Distribution Similarity</h5>
                        <p>Higher scores indicate better similarity between original and synthetic distributions</p>
                        <div class="table-responsive">
                            <table class="table table-sm">
                                <thead>
                                    <tr>
                                        <th>Column</th>
                                        <th>Score</th>
                                    </tr>
                                </thead>
                                <tbody>
                `;

                    Object.entries(properties.column_shapes).forEach(([column, score]) => {
                        qualityHTML += `
                            <tr>
                                <td>${column}</td>
                                <td>${typeof score === 'number' ? score.toFixed(4) : score}</td>
                            </tr>
                        `;
                    });

                    qualityHTML += `
                                </tbody>
                            </table>
                        </div>
                    `;
                }

                // Add other properties if available
                Object.entries(properties).forEach(([propName, propValue]) => {
                    if (propName !== 'column_shapes' && typeof propValue === 'object') {
                        qualityHTML += `
                            <h5 class="mt-3">${propName.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}</h5>
                            <div class="table-responsive">
                                <table class="table table-sm">
                                    <thead>
                                        <tr>
                                            <th>Metric</th>
                                            <th>Value</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                `;

                        Object.entries(propValue).forEach(([metric, value]) => {
                            qualityHTML += `
                                <tr>
                                    <td>${metric}</td>
                                    <td>${typeof value === 'number' ? value.toFixed(4) : value}</td>
                                </tr>
                            `;
                        });

                        qualityHTML += `
                                    </tbody>
                                </table>
                            </div>
                        `;
                    }
                });
            }
        }

        qualityElement.innerHTML = qualityHTML;

        // Visualizations tab
        const visualizationsElement = document.getElementById('visualizationsContent');
        visualizationsElement.innerHTML = '';

        // Add histogram visualizations
        Object.keys(visualizations || {}).forEach(key => {
            if (key.startsWith('hist_')) {
                const colName = key.replace('hist_', '');
                const container = document.createElement('div');
                container.className = 'col-md-6 visualization-container';
                container.innerHTML = `
                    <h5>Distribution of ${colName}</h5>
                    <img src="data:image/png;base64,${visualizations[key]}" alt="Distribution of ${colName}">
                `;
                visualizationsElement.appendChild(container);
            }
        });

        // Add PCA visualization
        if (visualizations && visualizations.pca) {
            const container = document.createElement('div');
            container.className = 'col-md-6 visualization-container';
            container.innerHTML = `
                <h5>PCA: Original vs Synthetic Data</h5>
                <img src="data:image/png;base64,${visualizations.pca}" alt="PCA visualization">
            `;
            visualizationsElement.appendChild(container);
        } else if (visualizations && visualizations.pca_error) {
            const container = document.createElement('div');
            container.className = 'col-12';
            container.innerHTML = `
                <div class="alert alert-warning">
                    Could not generate PCA visualization: ${visualizations.pca_error}
                </div>
            `;
            visualizationsElement.appendChild(container);
        }
    }

    // Helper function to convert JSON to CSV
    function convertToCSV(jsonData) {
        if (!jsonData || jsonData.length === 0) return '';

        const columns = Object.keys(jsonData[0]);
        let csv = columns.join(',') + '\n';

        jsonData.forEach(row => {
            let rowValues = columns.map(col => {
                let value = row[col];
                // Handle values that need quotes (strings with commas, quotes, or newlines)
                if (typeof value === 'string') {
                    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
                        value = '"' + value.replace(/"/g, '""') + '"';
                    }
                } else if (value === null || value === undefined) {
                    value = '';
                }
                return value;
            });
            csv += rowValues.join(',') + '\n';
        });

        return csv;
    }
}); 