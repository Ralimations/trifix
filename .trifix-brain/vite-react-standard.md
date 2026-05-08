# Vite React Standard
Default Vite React files:

* package.json
* index.html
* vite.config.js
* src/main.jsx
* src/App.jsx
* src/index.css
  package.json should include:
* dependencies.react
* dependencies.react-dom
* devDependencies.vite
* devDependencies.@vitejs/plugin-react
  Optional:
* src/data.js
  If Tailwind is requested, include:
* tailwind.config.js
* postcss.config.js
* Tailwind directives in src/index.css
  If Tailwind is not requested, use plain CSS.
  Required scripts:
* dev: vite --host 127.0.0.1
* build: vite build --base ./
* preview: vite preview --host 127.0.0.1
  If vite.config.js imports vite or @vitejs/plugin-react, package.json must include them.
