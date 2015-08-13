/*   Contact AddressBook Pane
**
**  This outline pane allows a user to interact with an contact,
to change its state according to an ontology, comment on it, etc.
**
**
** I am using in places single quotes strings like 'this'
** where internationalization ("i18n") is not a problem, and double quoted
** like "this" where the string is seen by the user and so I18n is an contact.
*/



if (typeof console == 'undefined') { // e.g. firefox extension. Node and browser have console
    console = {};
    console.log = function(msg) { tabulator.log.info(msg);};
}



//////////////////////////////////////////////////////  SUBCRIPTIONS

$rdf.subscription =  function(options, doc, onChange) {


    //  for all Link: uuu; rel=rrr  --->  { rrr: uuu }
    var linkRels = function(doc) {
        var links = {}; // map relationship to uri
        var linkHeaders = tabulator.fetcher.getHeader(doc, 'link');
        if (!linkHeaders) return null;
        linkHeaders.map(function(headerValue){
            var arg = headerValue.trim().split(';');
            var uri = arg[0];
            arg.slice(1).map(function(a){
                var key = a.split('=')[0].trim();
                var val = a.split('=')[1].trim();
                if (key ==='rel') {
                    links[val] = uri.trim();
                }
            });        
        });
        return links;
    };


    var getChangesURI = function(doc, rel) {
        var links = linkRels(doc);
        if (!links[rel]) {
            console.log("No link header rel=" + rel + " on " + doc.uri)
            return null;
        }
        var changesURI = $rdf.uri.join(links[rel], doc.uri);
        // console.log("Found rel=" + rel + " URI: " + changesURI);
        return changesURI;
    };



///////////////  Subscribe to changes by SSE


    var getChanges_SSE = function(doc, onChange) {
        var streamURI = getChangesURI(doc, 'events');
        if (!streamURI) return;
        var source = new EventSource(streamURI); // @@@  just path??
        console.log("Server Side Source");   

        source.addEventListener('message', function(e) {
            console.log("Server Side Event: " + e);   
            alert("SSE: " + e)  
            // $('ul').append('<li>' + e.data + ' (message id: ' + e.lastEventId + ')</li>');
        }, false);
    };

 
    

    //////////////// Subscribe to changes websocket

    // This implementation uses web sockets using update-via
    
    var getChanges_WS2 = function(doc, onChange) {
        var router = new $rdf.UpdatesVia(tabulator.fetcher); // Pass fetcher do it can subscribe to headers
        var wsuri = getChangesURI(doc, 'changes').replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');
        router.register(wsuri, doc.uri);
    };
    
    var getChanges_WS = function(doc, onChange) {
        var SQNS = $rdf.Namespace('http://www.w3.org/ns/pim/patch#');
        var changesURI = getChangesURI(doc, 'updates'); //  @@@@ use single
        var socket;
        try {
            socket = new WebSocket(changesURI);
        } catch(e) {
            socket = new MozWebSocket(changesURI);
        };
        
        socket.onopen = function(event){
            console.log("socket opened");
        };
        
        socket.onmessage = function (event) {
            console.log("socket received: " +event.data);
            var patchText = event.data;
            console.log("Success: patch received:" + patchText);
            
            // @@ check integrity of entire patch
            var patchKB = $rdf.graph();
            var sts;
            try {
                $rdf.parse(patchText, patchKB, doc.uri, 'text/n3');
            } catch(e) {
                console.log("Parse error in patch: "+e);
            };
            clauses = {};
            ['where', 'insert', 'delete'].map(function(pred){
                sts = patchKB.statementsMatching(undefined, SQNS(pred), undefined);
                if (sts) clauses[pred] = sts[0].object;
            });
            console.log("Performing patch!");
            kb.applyPatch(clauses, doc, function(err){
                if (err) {
                    console.log("Incoming patch failed!!!\n" + err)
                    alert("Incoming patch failed!!!\n" + err)
                    socket.close();
                } else {
                    console.log("Incoming patch worked!!!!!!\n" + err)
                    onChange(); // callback user
                };
            });
        };

    }; // end getChanges
    

    ////////////////////////// Subscribe to changes using Long Poll

    // This implementation uses link headers and a diff returned by plain HTTP
    
    var getChanges_LongPoll = function(doc, onChange) {
        var changesURI = getChangesURI(doc, 'changes');
        if (!changesURI) return "No advertized long poll URI";
        console.log(tabulator.panes.utils.shortTime() + " Starting new long poll.")
        var xhr = $rdf.Util.XMLHTTPFactory();
        xhr.alreadyProcessed = 0;

        xhr.onreadystatechange = function(){
            switch (xhr.readyState) {
            case 0:
            case 1:
                return;
            case 3:
                console.log("Mid delta stream (" + xhr.responseText.length + ") "+ changesURI);
                handlePartial();
                break;
            case 4:
                handlePartial();
                console.log(tabulator.panes.utils.shortTime() + " End of delta stream " + changesURI);
                break;
             }   
        };

        try {
            xhr.open('GET', changesURI);
        } catch (er) {
            console.log("XHR open for GET changes failed <"+changesURI+">:\n\t" + er);
        }
        try {
            xhr.send();
        } catch (er) {
            console.log("XHR send failed <"+changesURI+">:\n\t" + er);
        }

        var handlePartial = function() {
            // @@ check content type is text/n3

            if (xhr.status >= 400) {
                console.log("HTTP (" + xhr.readyState + ") error " + xhr.status + "on change stream:" + xhr.statusText);
                console.log("     error body: " + xhr.responseText);
                xhr.abort();
                return;
            } 
            if (xhr.responseText.length > xhr.alreadyProcessed) {
                var patchText = xhr.responseText.slice(xhr.alreadyProcessed);
                xhr.alreadyProcessed = xhr.responseText.length;
                
                console.log(tabulator.panes.utils.shortTime() + " Long poll returns, processing...")
                xhr.headers = $rdf.Util.getHTTPHeaders(xhr);
                try {
                    onChange(patchText);
                } catch (e) {
                    console.log("Exception in patch update handler: " + e)
                    // @@ Where to report error e?
                }
                getChanges_LongPoll(doc, onChange); // Queue another one
                
            }        
        };
        return null; // No error

    }; // end getChanges_LongPoll
    
    if (options.longPoll ) {
        getChanges_LongPoll(doc, onChange);
    }
    if (options.SSE) {
        getChanges_SSE(doc, onChange);
    }
    if (options.websockets) {
        getChanges_WS(doc, onChange);
    }

}; // subscription

/////////////////////////////////////////// End of subscription stufff 




    
// These used to be in js/init/icons.js but are better in the pane.
tabulator.Icon.src.icon_contactCard = iconPrefix + 'js/panes/contact/card.png';
tabulator.Icon.tooltips[tabulator.Icon.src.icon_contactCard] = 'Contact'

tabulator.panes.register( {

    icon: tabulator.Icon.src.icon_contactCard,
    
    name: 'contact',
    
    // Does the subject deserve an contact pane?
    label: function(subject) {
        var kb = tabulator.kb;
        var ns = tabulator.ns;
        var t = kb.findTypeURIs(subject);
        if (t[ns.vcard('Individual').uri]) return "Contact";
        if (t[ns.vcard('Group').uri]) return "Group";
        if (t[ns.vcard('AddressBook').uri]) return "Address book";
        return null; // No under other circumstances
    },

    render: function(subject, dom) {
        var kb = tabulator.kb;
        var ns = tabulator.ns;
        var DC = $rdf.Namespace('http://purl.org/dc/elements/1.1/');
        var DCT = $rdf.Namespace('http://purl.org/dc/terms/');
        var div = dom.createElement("div")
        var cardDoc = kb.sym(subject.uri.split('#')[0]);
        
        div.setAttribute('class', 'contactPane');
        div.innherHTML='<h1>Contact</h1><p>This is a pane under development</p>';

        var commentFlter = function(pred, inverse) {
            if (!inverse && pred.uri == 
                'http://www.w3.org/2000/01/rdf-schema#comment') return true;
            return false
        }
        
        var setModifiedDate = function(subj, kb, doc) {
            if (!getOption(tracker, 'trackLastModified')) return;
            var deletions = kb.statementsMatching(subject, DCT('modified'));
            var deletions = deletions.concat(kb.statementsMatching(subject, ns.wf('modifiedBy')));
            var insertions = [ $rdf.st(subject, DCT('modified'), new Date(), doc) ];
            if (me) insertions.push($rdf.st(subject, ns.wf('modifiedBy'), me, doc) );
            updater.update(deletions, insertions, function(uri, ok, body){});
        }

        var say = function say(message, style){
            var pre = dom.createElement("pre");
            pre.setAttribute('style', style ? style :'color: grey');
            div.appendChild(pre);
            pre.appendChild(dom.createTextNode(message));
            return pre
        } 

        var complainIfBad = function(ok,body){
            if (ok) {
            }
            else console.log("Sorry, failed to save your change:\n"+body, 'background-color: pink;');
        }

        var getOption = function (tracker, option){ // eg 'allowSubContacts'
            var opt = kb.any(tracker, ns.ui(option));
            return !!(opt && opt.value);
        }


        var thisPane = this;
        var rerender = function(div) {
            var parent  = div.parentNode;
            var div2 = thisPane.render(subject, dom);
            parent.replaceChild(div2, div);
        };

        var timestring = function() {
            var now = new Date();
            return ''+ now.getTime();
            // http://www.w3schools.com/jsref/jsref_obj_date.asp
        }


         
        

                                                  
        /////////////////////// Reproduction: Spawn a new instance of this app
        
        var newAddressBookButton = function(thisAddressBook) {
            return tabulator.panes.utils.newAppInstance(dom, "Start your own new address book", function(ws){
        
                var appPathSegment = 'com.timbl.contactor'; // how to allocate this string and connect to 

                // console.log("Ready to make new instance at "+ws);
                var sp = tabulator.ns.space;
                var kb = tabulator.kb;
                
                var base = kb.any(ws, sp('uriPrefix')).value;
                if (base.slice(-1) !== '/') {
                    $rdf.log.error(appPathSegment + ": No / at end of uriPrefix " + base );
                    base = base + '/';
                }
                base += appPathSegment + '/' + timestring() + '/'; // unique id 

                var documentOf = function(x) {
                    return kb.sym($rdf.uri.docpart(x.uri));
                }

                var stateStore = kb.any(tracker, ns.wf('stateStore'));
                var newStore = kb.sym(base + 'store.ttl');

                var here = documentOf(thisAddressBook);

                var oldBase = here.uri.slice(0, here.uri.lastIndexOf('/')+1);

                var morph = function(x) { // Move any URIs in this space into that space
                    if (x.elements !== undefined) return x.elements.map(morph); // Morph within lists
                    if (x.uri === undefined) return x;
                    var u = x.uri;
                    if (u === stateStore.uri) return newStore; // special case
                    if (u.slice(0, oldBase.length) === oldBase) {
                        u = base + u.slice(oldBase.length);
                        $rdf.log.debug(" Map "+ x.uri + " to " + u);
                    }
                    return kb.sym(u);
                }
                var there = morph(here);
                var newAddressBook = morph(thisAddressBook); 
                
                var myConfig = kb.statementsMatching(undefined, undefined, undefined, here);
                for (var i=0; i < myConfig.length; i++) {
                    st = myConfig[i];
                    kb.add(morph(st.subject), morph(st.predicate), morph(st.object), there);
                }
                
                // Keep a paper trail   @@ Revisit when we have non-public ones @@ Privacy
                //
                kb.add(newAddressBook, tabulator.ns.space('inspiration'), thisAddressBook, stateStore);
                
                kb.add(newAddressBook, tabulator.ns.space('inspiration'), thisAddressBook, there);
                
                // $rdf.log.debug("\n Ready to put " + kb.statementsMatching(undefined, undefined, undefined, there)); //@@


                updater.put(
                    there,
                    kb.statementsMatching(undefined, undefined, undefined, there),
                    'text/turtle',
                    function(uri2, ok, message) {
                        if (ok) {
                            updater.put(newStore, [], 'text/turtle', function(uri3, ok, message) {
                                if (ok) {
                                    console.info("Ok The tracker created OK at: " + newAddressBook.uri +
                                    "\nMake a note of it, bookmark it. ");
                                } else {
                                    console.log("FAILED to set up new store at: "+ newStore.uri +' : ' + message);
                                };
                            });
                        } else {
                            console.log("FAILED to save new tracker at: "+ there.uri +' : ' + message);
                        };
                    }
                );
                
                // Created new data files.
                // @@ Now create initial files - html skin, (Copy of mashlib, css?)
                // @@ Now create form to edit configuation parameters
                // @@ Optionally link new instance to list of instances -- both ways? and to child/parent?
                // @@ Set up access control for new config and store. 
                
            }); // callback to newAppInstance

            
        }; // newAddressBookButton

 
 
///////////////////////////////////////////////////////////////////////////////
        
        
        
        var updater = new tabulator.rdf.sparqlUpdate(kb);

 
        var plist = kb.statementsMatching(subject)
        var qlist = kb.statementsMatching(undefined, undefined, subject)

        var t = kb.findTypeURIs(subject);

        var me_uri = tabulator.preferences.get('me');
        var me = me_uri? kb.sym(me_uri) : null;


        // Reload resorce then
        
        var reloadStore = function(store, callBack) {
            tabulator.fetcher.unload(store);
            tabulator.fetcher.nowOrWhenFetched(store.uri, undefined, function(ok, body){
                if (!ok) {
                    console.log("Cant refresh data:" + body);
                } else {
                    callBack();
                };
            });
        };



        // Refresh the DOM tree
      
        var refreshTree = function(root) {
            if (root.refresh) {
                root.refresh();
                return;
            }
            for (var i=0; i < root.children.length; i++) {
                refreshTree(root.children[i]);
            }
        }



        //              Render a single contact Individual
        
        if (t[ns.vcard('Individual').uri]) {

            var individualFormDoc = kb.sym(iconPrefix + 'js/panes/contact/individualForm.ttl');
            var individualForm = kb.sym(individualFormDoc.uri + '#form1')

            tabulator.fetcher.nowOrWhenFetched(individualFormDoc.uri, subject, function drawContactPane(ok, body) {
                if (!ok) return console.log("Failed to load form " + indiviaualForm.uri + ' '+body);
                var predicateURIsDone = {};
                var donePredicate = function(pred) {predicateURIsDone[pred.uri]=true};
                donePredicate(ns.rdf('type'));
                donePredicate(ns.dc('title'));
                
                donePredicate(ns.vcard('UID'));


                var setPaneStyle = function() {
                    var types = kb.findTypeURIs(subject);
                    var mystyle = "padding: 0.5em 1.5em 1em 1.5em; ";
                    var backgroundColor = null;
                    for (var uri in types) {
                        backgroundColor = kb.any(kb.sym(uri), kb.sym('http://www.w3.org/ns/ui#backgroundColor'));
                        if (backgroundColor) break;
                    }
                    backgroundColor = backgroundColor ? backgroundColor.value : '#eee'; // default grey
                    mystyle += "background-color: " + backgroundColor + "; ";
                    div.setAttribute('style', mystyle);
                }
                setPaneStyle();
                

                tabulator.panes.utils.checkUserSetMe(cardDoc);

                tabulator.panes.utils.appendForm(dom, div, {}, subject, individualForm, cardDoc, complainIfBad);
                 
                 
                 //   Comment/discussion area
                /*
                var messageStore = kb.any(tracker, ns.wf('messageStore'));
                if (!messageStore) messageStore = kb.any(tracker, ns.wf('stateStore'));                
                div.appendChild(tabulator.panes.utils.messageArea(dom, kb, subject, messageStore));
                donePredicate(ns.wf('message'));
                */

/*
                // Add in simple comments about the bug - if not already in extras form.
                if (!predicateURIsDone[ns.rdfs('comment').uri]) {
                    tabulator.outline.appendPropertyTRs(div, plist, false,
                        function(pred, inverse) {
                            if (!inverse && pred.sameTerm(ns.rdfs('comment'))) return true;
                            return false
                        });
                    donePredicate(ns.rdfs('comment'));
                };
*/
                div.appendChild(dom.createElement('tr'))
                            .setAttribute('style','height: 1em'); // spacer
                
                // Remaining properties
                tabulator.outline.appendPropertyTRs(div, plist, false,
                    function(pred, inverse) {
                        return !(pred.uri in predicateURIsDone)
                    });
                tabulator.outline.appendPropertyTRs(div, qlist, true,
                    function(pred, inverse) {
                        return !(pred.uri in predicateURIsDone)
                    });
                    
                var refreshButton = dom.createElement('button');
                refreshButton.textContent = "refresh";
                refreshButton.addEventListener('click', function(e) {
                    tabulator.fetcher.unload(messageStore);
                    tabulator.fetcher.nowOrWhenFetched(messageStore.uri, undefined, function(ok, body){
                        if (!ok) {
                            console.log("Cant refresh messages" + body);
                        } else {
                            refreshTree(div);
                            // syncMessages(subject, messageTable);
                        };
                    });
                }, false);
                div.appendChild(refreshButton);



                    
            });  // End nowOrWhenFetched tracker

    ///////////////////////////////////////////////////////////

        //          Render a AddressBook instance
        
        } else if (t[ns.vcard('AddressBook').uri]) {
            var tracker = subject;
            
            var nameEmailIndex = kb.any(subject, ns.vcard('nameEmailIndex'));
            
            var groupIndex = kb.any(subject, ns.vcard('groupIndex'));
            
            //var cats = kb.each(subject, ns.wf('contactCategory')); // zero or more
            
            var h = dom.createElement('h2');
            h.setAttribute('style', 'font-size: 120%');
            div.appendChild(h);
            classLabel = tabulator.Util.label(ns.vcard('AddressBook'));
            
            var title = kb.any(subject, ns.dc('title'));
            title = title ? title.value : classLabel;
            h.appendChild(dom.createTextNode(title)); 

            // New Contact button
            var b = dom.createElement("button");
            var container = dom.createElement("div");
            b.setAttribute("type", "button");
            if (!me) b.setAttribute('disabled', 'true')
            container.appendChild(b);
            div.appendChild(container);
            b.innerHTML = "New "+classLabel;
            b.addEventListener('click', function(e) {
                    b.setAttribute('disabled', 'true');
                    // container.appendChild(newContactForm(dom, kb, subject));   // @@@@ todo
                }, false);
 
            
            
            ////////////////////////////// Three-column Contact Browser
            
            if (1) tabulator.fetcher.nowOrWhenFetched(groupIndex.uri, subject, function(ok, body) {
        
                if (!ok) return console.log("Cannot load group index: "+body);
                
                
                var bookTable = dom.createElement('table');
                div.appendChild(bookTable);
                var bookHeader = bookTable.appendChild(dom.createElement('tr'));
                var bookMain = bookTable.appendChild(dom.createElement('tr'));
                var groupsHeader =  bookHeader.appendChild(dom.createElement('td'));
                var peopleHeader =  bookHeader.appendChild(dom.createElement('td'));
                var cardHeader =  bookHeader.appendChild(dom.createElement('td'));
                var groupsMain = bookMain.appendChild(dom.createElement('td'));
                var groupsMainTable = groupsMain.appendChild(dom.createElement('table'));
                var peopleMain = bookMain.appendChild(dom.createElement('td'));
                var peopleMainTable = peopleMain.appendChild(dom.createElement('table'));
                
                var cardMain = bookMain.appendChild(dom.createElement('td'));
                
                groupsHeader.textContent = "groups";
                peopleHeader.textContent = "name";
                peopleHeader.setAttribute('style', 'min-width: 18em;');
                cardHeader.textContent = "contact details";
                
                
                var groups = kb.each(subject, ns.vcard('includesGroup'));
                var groups2 = groups.map(function(g){return [ kb.any(g, ns.vcard('fn')), g] })
                groups.sort();
                var selected = {};
                var refreshGroupRow = function(row, group) {
                    row.setAttribute('style', selected[group.uri] ? 'background-color: #cce;' : '') 
                }

                var cardPane = function(dom, subject, paneName) {
                    var p = tabulator.panes.byName(paneName);
                    var d = p.render(subject, dom);
                    d.setAttribute('style', 'border: 0.1em solid green;')
                    return d;
                };



                var refreshNames = function() {
                    var cards = [];
                    for (var u in selected) {
                        if (selected[u]) {
                            var a = kb.each(kb.sym(u), ns.vcard('hasMember'));
                            dump('Adding '+ a.length + ' people from ' + u + '\n')
                            cards = cards.concat(a);
                        }
                    }
                    cards.sort(); // @@ sort by name not UID later
                    peopleMainTable.innerHTML = ''; // clear
                    for (var j =0; j < cards.length; j++) {
                        var personRow = peopleMainTable.appendChild(dom.createElement('tr'));
                        var person = cards[j];
                        var name = kb.any(person, ns.vcard('fn'));
                        
                        name = name ? name.value : '???';
                        personRow.textContent = name;

                        var setPersonListener = function toggle(personRow, person) {
                            personRow.addEventListener('click', function(event){
                                dump("click person " + person + '; ' + '\n');
                                event.preventDefault();
                                cardMain.innerHTML = 'loading...';
                                var cardURI = person.uri.split('#')[0];
                                dump('Loading card '+ cardURI + '\n')
                                tabulator.fetcher.nowOrWhenFetched(cardURI, undefined, function(ok, message){
                                    cardMain.innerHTML = '';
                                    if (!ok) return complainIfBad(ok, "Can't load card: " +  group.uri.split('#')[0] + ": " + message)
                                    dump("Loaded card " + cardURI + '\n')
                                    cardMain.appendChild(cardPane(dom, person, 'contact'));            
                                })
                           });
                        };
                        setPersonListener(personRow, person);
                    };
    
                }
                
                for (var i =0; i<groups2.length; i++) {
                    var name = groups2[i][0];
                    var group = groups2[i][1];
                    selected[group.uri] = false;
                    var groupRow = groupsMainTable.appendChild(dom.createElement('tr'));
                    groupRow.subject = group;
                    // var groupLeft = groupRow.appendChild(dom.createElement('td'));
                    // var groupRight = groupRow.appendChild(dom.createElement('td'));
                    groupRow.textContent = name;
                    // var checkBox = groupLeft.appendChild(dom.createElement('input'))
                    // checkBox.setAttribute('type', 'checkbox'); // @@ set from personal last settings
                    var foo = function toggle(groupRow, group) {
                        groupRow.addEventListener('click', function(event){
                            event.preventDefault();
                            var groupList = kb.sym(group.uri.split('#')[0]);
                            if (!event.shiftKey) {
                                selected = {}; // If shift key pressed, accumulate multiple
                            }
                            selected[group.uri] = selected[group.uri] ? false : true;
                            dump("click group " + group + '; ' + selected[group.uri] + '\n');
                            kb.fetcher.nowOrWhenFetched(groupList.uri, undefined, function(ok, message){
                                if (!ok) return complainIfBad(ok, "Can't load group file: " +  groupList + ": " + message);
                                dump("Loaded group file " + groupList + '\n')
                                refreshGroupRow(groupRow, group);
                                refreshNames();
                            })
                        }, true);
                    };
                    foo(groupRow, group);
                }
                
             
            });
                                             
            // Table of contacts - when we have the main big contact list
            if (0) tabulator.fetcher.nowOrWhenFetched(nameEmailIndex.uri, subject, function(ok, body) {
        
                if (!ok) return console.log("Cannot load people index: "+body);
                
                var query = new $rdf.Query(tabulator.Util.label(subject));
                var vars =  ['contact', 'name', 'em', 'email'];
                var v = {}; // The RDF variable objects for each variable name
                vars.map(function(x){query.vars.push(v[x]=$rdf.variable(x))});
                query.pat.add(v['contact'], ns.vcard('fn'), v['name']);

                query.pat.add(v['contact'], ns.vcard('hasEmail'), v['em']);

                query.pat.add(v['contact'], ns.vcard('value'), v['email']);

                query.pat.optional = [];
                
                var propertyList = kb.any(subject, ns.wf('propertyList')); // List of extra properties
                // console.log('Property list: '+propertyList); //
                if (propertyList) {
                    properties = propertyList.elements;
                    for (var p=0; p < properties.length; p++) {
                        var prop = properties[p];
                        var vname = '_prop_'+p;
                        if (prop.uri.indexOf('#') >= 0) {
                            vname = prop.uri.split('#')[1];
                        }
                        var oneOpt = new $rdf.IndexedFormula();
                        query.pat.optional.push(oneOpt);
                        query.vars.push(v[vname]=$rdf.variable(vname));
                        oneOpt.add(v['contact'], prop, v[vname]);
                    }
                }
                
            
                        
                var tableDiv = tabulator.panes.utils.renderTableViewPane(dom, {'query': query,
       /*             'hints': {
                        '?created': { 'cellFormat': 'shortDate'},
                        '?state': { 'initialSelection': selectedStates }}
                        */
                    } );
                        
                div.appendChild(tableDiv);

                if (tableDiv.refresh) { // Refresh function
                    var refreshButton = dom.createElement('button');
                    refreshButton.textContent = "refresh";
                    refreshButton.addEventListener('click', function(e) {
                        tabulator.fetcher.unload(nameEmailIndex);
                        tabulator.fetcher.nowOrWhenFetched(nameEmailIndex.uri, undefined, function(ok, body){
                            if (!ok) {
                                console.log("Cant refresh data:" + body);
                            } else {
                                tableDiv.refresh();
                            };
                        });
                    }, false);
                    div.appendChild(refreshButton);
                } else {
                    console.log('No refresh function?!');
                }
                            
                
                
                
            });
            div.appendChild(dom.createElement('hr'));
            div.appendChild(newAddressBookButton(subject));
            // end of AddressBook instance


        } else { 
            console.log("Error: Contact pane: No evidence that "+subject+" is either a bug or a tracker.")
        }         
        if (!tabulator.preferences.get('me')) {
            console.log("(You do not have your Web Id set. Sign in or sign up to make changes.)");
        } else {
            // console.log("(Your webid is "+ tabulator.preferences.get('me')+")");
        };
        
        /////////////////  Obsolete log in out now?
        
        /*
        var loginOutButton = tabulator.panes.utils.loginStatusBox(dom, function(webid){
            // sayt.parent.removeChild(sayt);
            if (webid) {
                tabulator.preferences.set('me', webid);
                console.log("(Logged in as "+ webid+")")
                me = kb.sym(webid);
            } else {
                tabulator.preferences.set('me', '');
                console.log("(Logged out)")
                me = null;
            }
        });
        
        loginOutButton.setAttribute('style', 'float: right'); // float the beginning of the end

        div.appendChild(loginOutButton);
        */
        
        return div;

    }
}, true);

//ends


