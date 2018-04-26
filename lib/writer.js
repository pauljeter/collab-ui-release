'use strict';

var Bluebird = require('bluebird');

var DEFAULT_TYPE = 'other';
var TYPES = {
  chore: 'Chores',
  docs: 'Documentation Changes',
  feat: 'New Features',
  fix: 'Bug Fixes',
  other: 'Other Changes',
  refactor: 'Refactors',
  style: 'Code Style Changes',
  test: 'Tests',
  break: 'Breaking Changes',
};

exports.markdown = function (version, commits, options) {
  var content = [];
  var now = new Date();
  var date = now.getFullYear() + '-' + (now.getMonth() + 1) + '-' + now.getDate();
  var heading = '###';

  heading += ' ' + version + ' (' + date + ')';

  content.push(heading);
  content.push('');

  return Bluebird.resolve(commits)
    .bind({ types: {} })
    .each(function(commit) {
      var type = TYPES[commit.type] ? commit.type : DEFAULT_TYPE;
      var category = commit.category;

      this.types[type] = this.types[type] || {};
      this.types[type][category] = this.types[type][category] || [];
      this.types[type][category].push(commit);
    })
    .then(function() {
      return Object.keys(this.types).sort();
    })
    .each(function(type) {
      var types = this.types;

      content.push('#### ' + TYPES[type]);
      content.push('');

      Object.keys(this.types[type]).forEach(function (category) {
        var prefix = '*';
        var nested = types[type][category].length > 1;
        var categoryHeading = '* **' + category + ':**';

        if (nested) {
          content.push(categoryHeading);
          prefix = '  *';
        } else {
          prefix = categoryHeading;
        }

        types[type][category].forEach(function(commit) {
          var shorthash = commit.hash.substring(0, 8);

          if (options.repoUrl) {
            shorthash = '[' + shorthash + '](' + options.repoUrl + '/commit/' + commit.hash + ')';
          }

          content.push(prefix + ' ' + commit.subject + ' (' + shorthash + ')');
        });
      });

      content.push('');
    })
    .then(function() {
      content.push('');
      return content.join('\n');
    });
};

exports.mergeMarkdown = function(oldContent, newContent) {
  return new Bluebird( (resolve, reject) => {
    // this is a bit janky but it works.
    var oldLines = oldContent.split('\n');
    oldLines.shift();
    oldLines.shift();
    var newLines = newContent.split('\n');
    newLines.unshift('');
    newLines.unshift('All notable changes to this project will be documented in this file.');
    newLines.unshift('## Change Log');
    resolve(newLines.concat(oldLines).join('\n'));
  });
};
