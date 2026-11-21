// Render documentation diagrams with accessible typography and reduced connector crossings.
document.addEventListener('DOMContentLoaded', () => {
  if (window.mermaid) {
    window.mermaid.initialize({
      startOnLoad: true,
      securityLevel: 'strict',
      theme: 'base',
      themeVariables: {
        fontFamily: '"Atkinson Hyperlegible", sans-serif',
        fontSize: '16px',
        lineColor: '#334155',
        textColor: '#111827',
        primaryTextColor: '#111827',
        primaryColor: '#eef4f8',
        primaryBorderColor: '#334155',
        secondaryColor: '#f4f6f8',
        tertiaryColor: '#ffffff'
      },
      flowchart: {
        htmlLabels: true,
        curve: 'step',
        nodeSpacing: 64,
        rankSpacing: 72,
        useMaxWidth: true
      }
    });
  }
});
