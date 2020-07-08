import React from "react"
import { Sidebar } from "adminlte-2-react"
import PostOffice from "../../postOffice";

const { Item } = Sidebar

const MenuComponents = [
  {
    key: "Post Office",
    component: <PostOffice />,
    menuItem: <Item icon="fas-envelope" key="Post Office" text="Post Office" />,
  },
]

export default MenuComponents
