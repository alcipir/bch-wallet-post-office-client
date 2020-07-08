exports.onCreateWebpackConfig = ({ stage, actions, getConfig, plugins }) => {
    actions.setWebpackConfig({
      node: {
        fs: "empty",
      },

    })
  }
  
