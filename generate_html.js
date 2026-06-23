const fs = require('fs');
const marked = require('marked');

const markdown = fs.readFileSync('artifacts/api_workflow_postman.md', 'utf-8');
const htmlContent = marked.parse(markdown);

const htmlWrapper = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>API Documentation</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 800px;
            margin: 0 auto;
            padding: 20px;
        }
        h1, h2, h3 { color: #2c3e50; margin-top: 1.5em; }
        h1 { border-bottom: 2px solid #eee; padding-bottom: 10px; }
        h2 { border-bottom: 1px solid #eee; padding-bottom: 5px; }
        pre {
            background-color: #f8f9fa;
            border: 1px solid #e9ecef;
            border-radius: 4px;
            padding: 15px;
            overflow-x: auto;
        }
        code {
            font-family: Consolas, Monaco, 'Andale Mono', 'Ubuntu Mono', monospace;
            background-color: #f8f9fa;
            padding: 2px 4px;
            border-radius: 3px;
        }
        pre code { padding: 0; background-color: transparent; }
        hr { border: 0; border-top: 1px solid #eee; margin: 2em 0; }
        @media print {
            body { padding: 0; }
            pre { border: 1px solid #ccc; page-break-inside: avoid; }
            h2, h3 { page-break-after: avoid; }
            .no-print { display: none; }
        }
        .print-btn {
            display: block;
            width: 100%;
            padding: 15px;
            background: #007bff;
            color: white;
            text-align: center;
            text-decoration: none;
            font-size: 18px;
            font-weight: bold;
            border-radius: 5px;
            margin-bottom: 20px;
            cursor: pointer;
            border: none;
        }
    </style>
</head>
<body>
    <button class="print-btn no-print" onclick="window.print()">🖨️ Click Here to Save as PDF</button>
    ${htmlContent}
    <script>
        // Automatically trigger print dialog when opened
        window.onload = function() {
            setTimeout(() => window.print(), 500);
        };
    </script>
</body>
</html>
`;

fs.writeFileSync('artifacts/api_documentation.html', htmlWrapper);
console.log('HTML file created successfully.');
