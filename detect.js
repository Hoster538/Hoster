'use strict';
/* Zero-config runtime detection from a repo's root file listing.
 * Returns a deploy "plan": web service vs static site + commands. */

function plan(fileNames) {
  const files = new Set((fileNames || []).map((f) => f.toLowerCase()));
  const has = (f) => files.has(f.toLowerCase());

  if (has('Dockerfile')) {
    return { kind: 'web', env: 'docker', buildCommand: '', startCommand: '' };
  }
  if (has('package.json')) {
    return { kind: 'web', env: 'node', buildCommand: 'npm install', startCommand: 'npm start' };
  }
  if (has('requirements.txt')) {
    return { kind: 'web', env: 'python', buildCommand: 'pip install -r requirements.txt', startCommand: 'python app.py' };
  }
  if (has('pyproject.toml')) {
    return { kind: 'web', env: 'python', buildCommand: 'pip install .', startCommand: 'python app.py' };
  }
  if (has('go.mod')) {
    return { kind: 'web', env: 'go', buildCommand: 'go build -o app .', startCommand: './app' };
  }
  if (has('gemfile')) {
    return { kind: 'web', env: 'ruby', buildCommand: 'bundle install', startCommand: 'bundle exec ruby app.rb' };
  }
  if (has('index.html')) {
    return { kind: 'static', buildCommand: '', publishPath: '.' };
  }
  // Fallback: assume a Node-style web service; the name tells the user nothing.
  return { kind: 'web', env: 'node', buildCommand: '', startCommand: '' };
}

module.exports = { plan };
