// matches:   "https://staff-cms.lightning.force.com/lightning/r/*"


// const sleep = (delay) => new Promise ((resolve) => setTimeout(resolve, delay));

// async function waitPageToLoad() {
//     console.log('Call waitPageToLoad');
//     while(true) {
//         var subTabs = document.getElementsByClassName("tabContent");
//         console.log('before: subTabs.length: ' + subTabs.length);
//         if(subTabs.length == 0) {
//             console.log('Pause');
//             await sleep(500);
//         }
//         else {
//             break;
//         }
//     }
// }

// await waitPageToLoad();

console.log("---Before reformatEmbeddedJson()");
reformatEmbeddedJson();
console.log("---After reformatEmbeddedJson()");

// The body of this function will be executed as a content script inside the
// current page
function reformatEmbeddedJson() {
	var subTabs = document.getElementsByClassName("tabContent");
	console.log('subTabs.length: ' + subTabs.length);
	console.assert(subTabs.length > 0);

	var subTabsActive = document.getElementsByClassName("tabContent active");
	console.log('subTabsActive.length: ' + subTabsActive.length);
	console.assert(subTabsActive.length > 0);

	// Search all sub-tabs on the SalesForce page INT-REQ-*** where JSON blocks can be found
	var httpsRequestSections = [];
	var pageSections = document.getElementsByClassName("test-id__section"); 
	//DEBUG: console.log('pageSections.length: ' + pageSections.length);
	console.assert(pageSections.length > 0);
	for (let i=0; i<pageSections.length; i++) {
		var pageSectionHeaderTitles = pageSections[i].getElementsByClassName("test-id__section-header-title");
		//DEBUG: console.log('pageSectionHeaderTitles.length: ' + pageSectionHeaderTitles.length);
		if(pageSectionHeaderTitles.length > 0) {
			for(let j=0; j<pageSectionHeaderTitles.length; j++) {
				var pageSectionTitleText = pageSectionHeaderTitles[j].textContent;
				if (pageSectionTitleText == "HTTP Request Content") {
					//DEBUG: console.log("HTTP Request Content section found!")
					httpsRequestSections.push(pageSections[i]);  // form an array of INT-REQ-*** subTabs
				}
			}
		}
	}

	// For each INT-REQ-*** subTab, prettify JSON blocks on it
	for (let i=0; i<httpsRequestSections.length; i++) {
		var httpsRequestSection = httpsRequestSections[i];
		// "HTTP Request Content" expand/collapse button serving as a visual header of the "HTTP Request Content" section
		var buttons = httpsRequestSection.getElementsByClassName("test-id__section-header-button");
		//DEBUG: console.log('Number of buttons: ' + buttons.length);
		console.assert(buttons.length > 0);
		var isSectionExpanded = buttons[0].getAttribute("aria-expanded") == "true";
		//DEBUG: console.log('isSectionExpanded: ' + isSectionExpanded);
		if(!isSectionExpanded ) {
			buttons[0].click();
		}	

		// ---- AT this point, the "HTTP Request Content" section is expanded

		var json_containers = httpsRequestSection.getElementsByTagName("lightning-formatted-text");
		//DEBUG: console.log('Number of json containers: ' + json_containers.length);

		var json_container_in_header = json_containers[0];
		var json_container_in_body = json_containers[1];
		console.log(json_container_in_header.textContent);

		// Temporary element created from the embedded JSON text
		var json_tmp_obj = undefined;
		// PRE HTML element to be created to enclose the JSON text in Header and in Body to preserve indents and line breaks
		var new_pre_element = undefined;
		
		// Make the pretty JSON text from HTTP request Header
		json_tmp_obj = JSON.parse(json_container_in_header.textContent);
		new_pre_element = document.createElement("pre");
		new_pre_element.textContent = JSON.stringify(json_tmp_obj, undefined, 4); // enclose JSON text by PRE HTML element
		json_container_in_header.textContent = ""; 	// remove the previous not formatted JSON text
		json_container_in_header.appendChild(new_pre_element);  // insert new PRE element containing formatted JSON

		// Make the pretty JSON text from HTTP request Body
		json_tmp_obj = JSON.parse(json_container_in_body.textContent);
		new_pre_element = document.createElement("pre");
		new_pre_element.textContent = JSON.stringify(json_tmp_obj, undefined, 4); // enclose JSON text by PRE HTML element
		json_container_in_body.textContent = ""; 	// remove the previous not formatted JSON text
		json_container_in_body.appendChild(new_pre_element);  // insert new PRE element containing formatted JSON
	}	 
}