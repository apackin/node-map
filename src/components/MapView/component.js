import React, { Component, Fragment } from "react";
import ReactDOM from "react-dom";
import { withScriptjs, withGoogleMap, GoogleMap } from "react-google-maps";
import { withRouter, Route } from "react-router";
import DocumentTitle from "react-document-title";
import PropTypes from "prop-types";
import { uniq, isEqual } from "lodash";

import NodeMarker from "./NodeMarker";
import KioskMarker from "./KioskMarker";
import LinkLine from "./LinkLine";
import NodeDetail from "../NodeDetail";
import Gallery from "../Gallery";

import { mapStyles } from "./styles";

const DEFAULT_ZOOM = 13;
const DEFAULT_CENTER = { lat: 40.7031809, lng: -73.9595798 };

const options = {
	styles: mapStyles,
	fullscreenControl: false,
	streetViewControl: false,
	zoomControlOptions: {
		position: "9"
	},
	mapTypeControlOptions: {
		position: "3"
	},
	backgroundColor: "#f5f5f5",
	gestureHandling: "greedy",
	clickableIcons: false
};

const MapComponent = withScriptjs(
	withGoogleMap(props => (
		<GoogleMap ref={props.mapRef} {...props}>
			{props.children}
		</GoogleMap>
	))
);

class MapView extends Component {
	static contextTypes = {
		router: PropTypes.object
	};

	state = {
		commandPressed: false
	};

	constructor(props) {
		super(props);
		this.map = React.createRef();
		this.markerRefs = {};
		this.lineRefs = {};
	}

	componentDidMount() {
		this.keyDownHandler = this.handleKeyDown.bind(this);
		this.keyUpHandler = this.handleKeyUp.bind(this);
		window.addEventListener("keydown", this.keyDownHandler, false);
		window.addEventListener("keyup", this.keyUpHandler, false);

		if (this.props.match) {
			try {
				setTimeout(() => {
					this.handleSelectedChange(this.props);
				}, 500);
			} catch (e) {
				console.error(e);
			}
		}
	}

	componentWillUnmount() {
		window.removeEventListener("keydown", this.keyDownHandler, false);
		window.removeEventListener("keyup", this.keyUpHandler, false);
	}

	// This is a kinda hacky way to improve performance
	// Instead of rerending the entire map, rerender specific nodes
	shouldComponentUpdate(nextProps) {
		const nodesChanged = !isEqual(this.props.nodes, nextProps.nodes);
		const matchChanged = this.props.match !== nextProps.match;
		const filtersChanged = this.props.filters !== nextProps.filters;
		if (nodesChanged || matchChanged || filtersChanged) {
			this.handleSelectedChange(nextProps);
			return true;
		}

		return false;
	}

	handleKeyDown(event) {
		const { keyCode } = event;
		if (keyCode === 27) {
			const { history } = this.context.router;
			history.push("/");
		}

		// Command key
		if (keyCode === 91 || keyCode === 93) {
			this.setState({ commandPressed: true });
		}
	}

	handleKeyUp(event) {
		const { keyCode } = event;

		// Command key
		if (keyCode === 91 || keyCode === 93) {
			this.setState({ commandPressed: false });
		}
	}

	handleSelectedChange(nextProps) {
		// If selected node is unchanged, do not rerender
		if (!this.props.match && !nextProps.match) return false;

		// If one was selected but none now selected, reset all nodes
		if (!nextProps.match) {
			this.resetAllNodes();
			return false;
		}

		const nextSelectedNodeIds = this.selectedNodeIds(nextProps.match);
		const nextSelectedMarkers = nextSelectedNodeIds
			.map(id => this.markerRefs[id])
			.filter(m => m); // filter null

		if (!nextSelectedMarkers.length) {
			return;
		}

		const nextSelectedNodes = nextSelectedMarkers.map(
			marker => marker.props.node
		);
		this.updateNodes(nextSelectedNodes, nextSelectedMarkers);

		const matchChanged = this.props.match !== nextProps.match;
		const nodesChanged = this.props.nodes !== nextProps.nodes;
		const fitBounds = !matchChanged && !nodesChanged;

		const filtersChanged = this.props.filters !== nextProps.filters;

		if (!filtersChanged) {
			this.updateLinks(nextSelectedNodes);
			this.panToNodes(nextSelectedNodes, fitBounds);
		}
	}

	render() {
		const { history } = this.context.router;
		return (
			<MapComponent
				mapRef={this.map}
				defaultZoom={DEFAULT_ZOOM}
				defaultCenter={DEFAULT_CENTER}
				defaultOptions={options}
				onClick={() => history.push("/")}
				loadingElement={<div className="h-100" />}
				containerElement={<div className="h-100" />}
				mapElement={<div className="h-100" />}
				googleMapURL="https://maps.googleapis.com/maps/api/js?key=AIzaSyBNClp7oJsw-eleEoR3-PQKV23tpeW-FpE"
			>
				{this.renderLinks()}
				{this.renderKiosks()}
				{this.renderNodes()}
				{this.renderNodeDetail()}
				<Route
					exact
					path="/nodes/:nodeId/panoramas/:panoId"
					component={Gallery}
				/>
			</MapComponent>
		);
	}

	renderNodes() {
		const { nodes, filters } = this.props;
		const selectedNodeIdsMap = {};
		this.selectedNodeIds().forEach(
			nodeId => (selectedNodeIdsMap[nodeId] = true)
		);
		return nodes.map(node => {
			const isSelected = selectedNodeIdsMap[node.id];
			const hidden = filters[node.type] === false && !isSelected;
			return (
				<NodeMarker
					key={node.id}
					node={node}
					visible={!hidden}
					onClick={() => this.handleNodeClick(node)}
					ref={ref => {
						this.handleMarkerRef(ref);
					}}
				/>
			);
		});
	}

	renderLinks() {
		const { links, filters } = this.props;
		return links.map((link, index) => {
			const hidden =
				filters[link.fromNode.type] === false ||
				filters[link.toNode.type] === false;
			return (
				<LinkLine
					key={this.linkId(link)}
					ref={ref => {
						this.handleLineRef(ref);
					}}
					visible={!hidden}
					link={link}
				/>
			);
		});
	}

	renderKiosks() {
		const { kiosks } = this.props;
		return kiosks.map(kiosk => (
			<KioskMarker key={kiosk.id} kiosk={kiosk} />
		));
	}

	renderNodeDetail() {
		const { match } = this.props;
		if (!match || !match.params) {
			return null;
		}
		const nodeIds = this.selectedNodeIds();

		const nodeTitles = nodeIds.join(", ");
		const title = `${nodeTitles} - Map - NYC Mesh`;
		return (
			<DocumentTitle title={title}>
				<Fragment>
					{nodeIds.map(id => (
						<NodeDetail key={id} nodeId={id} />
					))}
				</Fragment>
			</DocumentTitle>
		);
	}

	handleNodeClick(node) {
		const { match } = this.props;
		const { history } = this.context.router;

		// Command click selects multiple nodes
		if (this.state.commandPressed && match && match.params.nodeId) {
			const nodeIds = this.selectedNodeIds();
			const selectedId = node.id.toString();

			let newNodeIds = [];
			if (nodeIds.indexOf(selectedId) > -1) {
				newNodeIds = nodeIds.filter(nodeId => nodeId !== selectedId);
			} else {
				nodeIds.push(selectedId);
				newNodeIds = nodeIds;
			}

			const newNodeIdString = uniq(newNodeIds)
				.sort()
				.join("-");
			history.replace(`/nodes/${newNodeIdString}`);
		} else {
			history.push(`/nodes/${node.id}`);
		}
	}

	resetAllNodes() {
		ReactDOM.unstable_batchedUpdates(() => {
			Object.values(this.markerRefs).forEach(marker =>
				marker.setVisibility("default")
			);

			Object.values(this.lineRefs).forEach(line =>
				line.setVisibility("default")
			);
		});
	}

	updateNodes(nodes, markers) {
		ReactDOM.unstable_batchedUpdates(() => {
			const activeIsSelected = nodes.reduce(
				(acc, node) => (acc = acc || node.status === "Installed"),
				false
			);

			// Dim all nodes of same type
			Object.values(this.markerRefs).forEach(marker => {
				if (
					!activeIsSelected &&
					marker.props.node.status === "Installed"
				) {
					marker.setVisibility("default");
				} else {
					marker.setVisibility("dim");
				}
			});

			// Highlight directly connected nodes
			nodes.forEach(node => {
				if (node.connectedNodes) {
					node.connectedNodes.forEach(nodeId => {
						const connectedMarker = this.markerRefs[nodeId];
						if (connectedMarker) {
							connectedMarker.setVisibility("secondary");
						}
					});
				}
			});

			// Highlight selected nodes
			markers.forEach(marker => marker.setVisibility("highlight"));
		});
	}

	updateLinks(nodes) {
		ReactDOM.unstable_batchedUpdates(() => {
			// Dim all links
			Object.values(this.lineRefs).forEach(line =>
				line.setVisibility("dim")
			);

			// Highlight direct links
			nodes.forEach(node => {
				if (node.links) {
					node.links.forEach(link => {
						const line = this.lineRefs[this.linkId(link)];
						if (line) {
							line.setVisibility("highlight");
						}
					});
				}
			});
		});
	}

	panToNodes(nodes, fitBounds) {
		if (nodes.length === 1) {
			const [lng, lat] = nodes[0].coordinates;
			this.map.current.panTo({ lng, lat });
			return;
		}

		let minLng = 9999,
			minLat = 9999,
			maxLng = -9999,
			maxLat = -9999;

		nodes.forEach(node => {
			const [lng, lat] = node.coordinates;
			if (lng < minLng) minLng = lng;
			if (lng > maxLng) maxLng = lng;
			if (lat < minLat) minLat = lat;
			if (lat > maxLat) maxLat = lat;
		});

		const newBounds = {
			east: maxLng,
			north: maxLat,
			south: minLat,
			west: minLng
		};

		if (fitBounds) {
			this.map.current.fitBounds(newBounds, window.innerWidth / 10);
		} else {
			this.map.current.panToBounds(newBounds, window.innerWidth / 10);
		}
	}

	handleMarkerRef(ref) {
		if (ref) {
			this.markerRefs[ref.props.node.id] = ref;
		}
	}

	handleLineRef(ref) {
		if (ref) {
			this.lineRefs[this.linkId(ref.props.link)] = ref;
		}
	}

	linkId(link) {
		return `${link.from}-${link.to} ${link.status}`;
	}

	selectedNodeIds(match = this.props.match) {
		if (!match || !match.params) {
			return [];
		}
		const { nodeId } = match.params;
		return nodeId.split("-");
	}
}

export default withRouter(MapView);
