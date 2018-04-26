#!/usr/bin/env node

'use strict';

var packageInfo = require(process.env.PWD + '/package.json');
var Promise = require('bluebird');
var retry = require('retry-bluebird');
var inquirer = require('inquirer');
var pexec = Promise.promisify(require('child_process').exec);
var GitHubApi = require('github');
var Writer = require('./lib/writer');
var File = require('./lib/file');
var ciscospark = require('ciscospark');

var ghProtocol = 'https';
var ghHost = 'wwwin-github.cisco.com';
var spark = null;
var branchName = 'master';

var github = new GitHubApi({
  debug: true,
  protocol: ghProtocol,
  host: ghHost,
  pathPrefix: '/api/v3', // for some GHEs; none for GitHub
    Promise: Promise,
});

var COMMIT_PATTERN = /^(\w*)(\(([\w\$\.\-\* ]*)\))?\: (.*)$/;
// Toolkit Updates Spark room id
var SPARK_ROOM_ID = 'Y2lzY29zcGFyazovL3VzL1JPT00vZDBlYzI2MTAtNWUyYi0xMWU1LWJiYjctNDM5OTVjNmIxOGJh';
// var SPARK_ROOM_ID = 'Y2lzY29zcGFyazovL3VzL1JPT00vMDM4OTBjNDAtNGEwMy0xMWU3LWEyYjYtOWRiNTgwZmFmMTk2'; // Test Space

function getBranchName() {
  return new Promise(function(resolve, reject) {
    pexec('git rev-parse --abbrev-ref HEAD')
      .then((branch) => {
        branchName = branch;
        console.log('\x1b[1m\x1b[37m%s\x1b[0m', `Using ${branchName} branch for release...`);
      })
      .then( () => {
        resolve();
      });
  });
}

function checkForPackageInfoRequirements() {
  return new Promise(function (resolve, reject) {
    if (!packageInfo.repository || !packageInfo.repository.url) {
      reject('{ \"repository\": { \"url\" } } is missing in package.json.\n[Reference: https://docs.npmjs.com/files/package.json#repository]');
    } else {
      resolve();
    }
  });
}

function checkForUncommitedChanges() {
  return new Promise(function (resolve, reject) {
    pexec("git status --porcelain | grep '^\\s*[MADRUC\\?]' | wc -l")
      .then((changeCount) => {
        if (changeCount > 0) {
          reject('Git working directory not clean.  You must commit changes in working directory first.');
        } else {
          resolve();
        }
      });
  });
}

function promptVersionType() {
  return new Promise(function (resolve, reject) {
    inquirer.prompt([
      {
        type: 'list',
        name: 'type',
        message: 'What type of release is this?',
        choices: [
          'major',
          'minor',
          'patch',
          'custom'
        ]
      }
    ]).then(function (answers) {
      if (answers.type === 'custom') {
        inquirer.prompt([
          {
            type: 'input',
            name: 'version',
            message: 'Enter your custom version.',
          }
        ])
        .then(function (answers) {
          resolve(answers.version);
        })
      } else {
        resolve(answers.type);
      }
    });
  });
}

function promptGitHubToken() {
  return new Promise(function (resolve, reject) {
    if (process.env.GITHUB_API_TOKEN) {
      resolve(process.env.GITHUB_API_TOKEN);
    } else {
      var questions = [
        {
          type: 'input',
          name: 'ghToken',
          validate: function (value) {
            var pass = value.match(/^\w+$/);
            if (pass) {
              return true;
            }

            return 'Please enter a valid GitHub Personal access token';
          },
          message: 'GitHub Personal access token:'
        }
      ];

      console.log("\x1b[33m%s\x1b[0m", "GITHUB_API_TOKEN env variable not found (set GITHUB_API_TOKEN to skip this prompt)")
      inquirer.prompt(questions).then(function (answers) {
        resolve(answers.ghToken);
      });
    }
  });
}

function promptCiscoSparkToken() {
  return new Promise(function (resolve, reject) {
    if (process.env.CISCOSPARK_ACCESS_TOKEN) {
      resolve(process.env.CISCOSPARK_ACCESS_TOKEN);
    } else {
      var questions = [
        {
          type: 'input',
          name: 'csToken',
          message: 'Cisco Spark access token:'
        }
      ];

      console.log("\x1b[33m%s\x1b[0m", "CISCOSPARK_ACCESS_TOKEN env variable not found (set CISCOSPARK_ACCESS_TOKEN to skip this prompt)");
      inquirer.prompt(questions).then(function (answers) {
        resolve(answers.csToken);
      });
    }
  });
}

function extractReleaseNotes(ghRepoOwner, ghRepo, version) {
  return getLatestTagCommit(ghRepoOwner, ghRepo)
    .then(commitSha => {
      return getTagCommitDate(ghRepoOwner, ghRepo, commitSha);
    }).then(commitDate => {
      return getCommitsSinceLastTag(ghRepoOwner, ghRepo, commitDate)
    }).then(commits => {
      return Writer.markdown(version, commits, { repoUrl: `${ghProtocol}://${ghHost}/${ghRepoOwner}/${ghRepo}` });
    });
}

function getCommitsSinceLastTag(ghRepoOwner, ghRepo, date) {
  return github.repos.getCommits({
    owner: ghRepoOwner,
    repo: ghRepo,
    since: date
  }).then(commits => {
    commits.pop(); // last commit listed is last tag commit, exclude it.
    if (commits.length && !commits.length > 0) {
      throw new Error('No commits found since last tag.');
    }
    return commits;
  }).map(rawCommit => {
    var lines = rawCommit.commit.message.split('\n');
    var commit = {};

    commit.hash = rawCommit.sha;
    commit.subject = lines.shift();
    commit.body = lines.join('\n');

    var parsed = commit.subject.match(COMMIT_PATTERN);

    if (!parsed || !parsed[1] || !parsed[4]) {
      return null;
    }
    commit.type = parsed[1].toLowerCase();
    commit.category = parsed[3];
    commit.subject = parsed[4];

    return commit;
  }).filter(commit => {
    return commit != null;
  });
}

function getTagCommitDate(ghRepoOwner, ghRepo, sha) {
  return github.repos.getCommit({
    owner: ghRepoOwner,
    repo: ghRepo,
    sha: sha
  }).then(commit => {
    return commit.commit.author.date;
  });
}

function getLatestTagCommit(ghRepoOwner, ghRepo) {
  return github.repos.getTags({
    owner: ghRepoOwner,
    repo: ghRepo
    }).then(tags => {
      return tags[0].commit.sha;
    });
}

function versionAndReturnTagName(versionType) {
  return new Promise( (resolve, reject) => {
    console.log('\x1b[1m\x1b[37m%s\x1b[0m', 'Versioning package...');
    pexec(`npm version ${versionType} --no-git-tag-version`)
      .then((output) => {
        let releaseTagName = output.trim();
        resolve(releaseTagName);
      });
  });
}

function checkForGithubTag(ghRepoOwner, ghRepo, releaseTagName) {
  console.log('\x1b[1m\x1b[37m%s\x1b[0m', `Checking for tag ${releaseTagName} in GitHub...`);
  return retry({max: 5, backoff: 1000}, () => {
    return github.repos.getTags({
      owner: ghRepoOwner,
      repo: ghRepo
      }).then(tags => {
        for(var i = 0; i < tags.length; i++) {
          if (tags[i].name === releaseTagName) {
            console.log('\x1b[1m\x1b[37m%s\x1b[0m', `${releaseTagName} tag found!`);
            return;
          } else {
            throw releaseTagName + ' not found';
          }
        }
      });
  });
}

function createGitHubRelease(ghRepoOwner, ghRepo, releaseTagName, releaseNotes) {
  console.log('\x1b[1m\x1b[37m%s\x1b[0m', 'Creating new release in GitHub...');
  return github.repos.createRelease({
    owner: ghRepoOwner,
    repo: ghRepo,
    tag_name: releaseTagName,
    name: releaseTagName,
    body: releaseNotes
  }).then(release => {
    return release;
  });
}

function tagAndPushCommit(version) {
  console.log('\x1b[1m\x1b[37m%s\x1b[0m', 'Creating commit...');
  return new Promise( (resolve, reject) => {
    pexec(`git add .`)
      .then( (command, output) => {
        return pexec(`git commit -a -m "chore(release): ${version}"`);
      })
      .then((command, output) => {
        console.log('\x1b[1m\x1b[37m%s\x1b[0m', `Applying tag ${version} to commit...`);
        return pexec(`git tag ${version}`);
      })
      .then((command, output) => {
        console.log('\x1b[1m\x1b[37m%s\x1b[0m', 'Pushing new release commit to GitHub...');
        return pexec(`git push origin ${branchName}`);
      })
      .then((command, output) => {
        console.log('\x1b[1m\x1b[37m%s\x1b[0m', 'Pushing new release tag to GitHub...');
        return pexec(`git push --tags`);
      })
      .then( () => {
        resolve();
      })
  });
}

function processChangelog(releaseNotes) {
  return File.readIfExists(process.env.PWD + '/CHANGELOG.md')
    .then(oldContent => {
      return Writer.mergeMarkdown(oldContent, releaseNotes);
    })
    .then(mergedContent => {
      return File.writeToFile(process.env.PWD + '/CHANGELOG.md', mergedContent);
    })
}

function sendSparkMessage(message) {
  const sparkMessage = `## ${packageInfo.name}\n ${message}`;
  return spark.messages.create({
    markdown: sparkMessage,
    roomId: SPARK_ROOM_ID,
  });
}

function npmPublish() {
  var cmd = 'npm publish';
  if(packageInfo.name === 'collab-ui-react'){
    cmd = 'npm run create_pkg_json;cd dist;'+cmd;
  }
  return pexec(cmd);
}

function getRepoName(repoUrl) {
  const repo = repoUrl.split('/').pop();
  return repo.split('.').shift();
}

function run() {
  let versionType = null;
  let releaseNotes = null;
  let releaseTagName = null;
  let ghRepoOwner = null;
  let ghRepo = null;

  checkForPackageInfoRequirements()
    .then(() => {
      return checkForUncommitedChanges();
    })
    .then(() => {
      return getBranchName();
    })
    .then(() => {
      return promptVersionType();
    })
    .then(type => {
      versionType = type;
      return promptGitHubToken();
    })
    .then(token => {
      ghRepoOwner = packageInfo.repository.url.match(/^http[s]?:\/\/.*?\/([a-zA-Z-_0-9]+).*$/)[1];
      ghRepo = getRepoName(packageInfo.repository.url);
      github.authenticate({
        type: "oauth",
        token: token
      });
      return promptCiscoSparkToken();
    })
    .then(csToken => {
      spark = ciscospark.init({
        credentials: {
          authorization: {
            access_token: csToken,
          }
        }
      });
      return versionAndReturnTagName(versionType);
    })
    .then(tagName => {
      releaseTagName = tagName;
      return extractReleaseNotes(ghRepoOwner, ghRepo, releaseTagName);
    })
    .then(notes => {
      releaseNotes = notes;
      return processChangelog(notes);
    })
    .then( () => {
      return tagAndPushCommit(releaseTagName);
    })
    .then( () => {
      return checkForGithubTag(ghRepoOwner, ghRepo, releaseTagName);
    })
    .then(() => {
      return createGitHubRelease(ghRepoOwner, ghRepo, releaseTagName, releaseNotes);
    })
    .then(output => {
      console.log('\x1b[1m\x1b[32m%s\x1b[0m', `${releaseTagName} released to GitHub - ${output.html_url}`);
      return npmPublish(releaseTagName);
    })
    .then(() => {
      console.log('\x1b[1m\x1b[32m%s\x1b[0m', `Version ${releaseTagName} of ${ghRepo} published to Artifactory`);
      return sendSparkMessage(releaseNotes);
    })
    .then(() => {
      console.log('\x1b[1m\x1b[32m%s\x1b[0m', 'Release Notes posted to Toolkit Updates Spark room.');
      process.exit(0);
    })
    .catch(errorMessage => {
      console.log('\x1b[31mERROR: %s\x1b[0m', errorMessage);
      process.exit(1);
    })
}

run();
