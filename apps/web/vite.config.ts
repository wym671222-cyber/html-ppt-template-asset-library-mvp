import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [sveltekit()],
	envPrefix: ['VITE_', 'PUBLIC_'],
	server: {
		host: '127.0.0.1',
	},
	preview: {
		host: '127.0.0.1',
	},
});
