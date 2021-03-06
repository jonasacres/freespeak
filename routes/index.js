// Freespeak, a zero-knowledge ephemeral chat server
// Copyright (C) 2016 Jonas Acres

// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as
// published by the Free Software Foundation, either version 3 of the
// License, or (at your option) any later version.

// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.

// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

var express = require('express');
var router = express.Router();
var pjson = require('../package.json');

function defaultRenderVars() {
  return {
    title:"Freespeak",
    name:pjson.name,
    version:pjson.version,
    donateAddress:"112FioiVChxs28ahM25s8imZ5397Jbanf",
    repoUrl:"https://github.com/jonasacres/freespeak",
  }
}

/* GET home page. */
router.get('/', function(req, res, next) {
  res.render('index', defaultRenderVars());
});

/* GET user page. */
router.get('/talk/:id', function(req, res, next) {
  res.render('index', defaultRenderVars());
});

module.exports = router;
