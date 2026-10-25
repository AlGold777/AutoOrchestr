const fs = require('fs');
const path = require('path');

const delay = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

describe('ResultsTooltips floating tooltip', () => {
  let tooltips;

  beforeEach(() => {
    document.body.innerHTML = '';
    document.head.innerHTML = '';
    window.requestAnimationFrame = (cb) => { cb(); return 0; };
    window.eval(fs.readFileSync(path.join(__dirname, '..', 'results', 'tooltips.js'), 'utf8'));
    tooltips = window.ResultsTooltips.create({ document });
  });

  const target = (attrs = {}) => {
    const el = document.createElement('button');
    el.id = 't';
    Object.entries(attrs).forEach(([key, value]) => el.setAttribute(key, value));
    document.body.appendChild(el);
    return el;
  };

  test('a target with a description shows the name and the description in separate elements', () => {
    const el = target({ 'data-tooltip': 'Название', 'data-tooltip-desc': 'Описание' });
    tooltips.registerTooltipTarget(el);
    tooltips.positionFloatingTooltip(el);
    const box = document.querySelector('.floating-tooltip');
    expect(box.querySelector('.floating-tooltip-name').textContent).toBe('Название');
    expect(box.querySelector('.floating-tooltip-desc').textContent).toBe('Описание');
  });

  test('markup in the name or the description is shown as text, not interpreted', () => {
    const el = target({ 'data-tooltip': '<b>x</b>', 'data-tooltip-desc': '<i>y</i>' });
    tooltips.positionFloatingTooltip(el);
    const box = document.querySelector('.floating-tooltip');
    expect(box.querySelectorAll('b')).toHaveLength(1);
    expect(box.querySelectorAll('i')).toHaveLength(0);
    expect(box.querySelector('.floating-tooltip-name').textContent).toBe('<b>x</b>');
    expect(box.querySelector('.floating-tooltip-desc').textContent).toBe('<i>y</i>');
  });

  test('a target without a description shows only the text', () => {
    const el = target({ 'data-tooltip': 'Только название' });
    tooltips.positionFloatingTooltip(el);
    const box = document.querySelector('.floating-tooltip');
    expect(box.textContent).toBe('Только название');
    expect(box.querySelector('.floating-tooltip-desc')).toBeNull();
    expect(box.querySelector('.floating-tooltip-name')).toBeNull();
  });

  test('a blank description adds no description element', () => {
    const el = target({ 'data-tooltip': 'Название', 'data-tooltip-desc': '   ' });
    tooltips.positionFloatingTooltip(el);
    const box = document.querySelector('.floating-tooltip');
    expect(box.querySelector('.floating-tooltip-desc')).toBeNull();
    expect(box.textContent).toBe('Название');
  });

  test('a second tooltip replaces the first one', () => {
    const first = target({ 'data-tooltip': 'Первое', 'data-tooltip-desc': 'Описание первого' });
    tooltips.positionFloatingTooltip(first);
    const second = document.createElement('button');
    second.setAttribute('data-tooltip', 'Второе');
    document.body.appendChild(second);
    tooltips.positionFloatingTooltip(second);
    const box = document.querySelector('.floating-tooltip');
    expect(box.querySelector('.floating-tooltip-desc')).toBeNull();
    expect(box.textContent).toBe('Второе');
  });

  test('the stylesheet gives the name and the description their own lines', () => {
    const css = fs.readFileSync(path.join(__dirname, '..', 'styles', 'app-controls.css'), 'utf8');
    expect(css).toMatch(/\.floating-tooltip-name\s*\{[^}]*display:\s*block/);
    expect(css).toMatch(/\.floating-tooltip-desc\s*\{[^}]*display:\s*block[^}]*white-space:\s*pre-wrap/);
  });
});
